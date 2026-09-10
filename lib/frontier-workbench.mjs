import { randomUUID } from "node:crypto";
import {
  BrainstemClient, BrainstemError, DEFAULT_URL, MAX_HISTORY_MESSAGES, normalizeBaseUrl, validateChatInput,
} from "./brainstem-client.mjs";

const MAX_RUNS = 20;
const MAX_HISTORY_CHARACTERS = 240_000;

function freshState(baseUrl = DEFAULT_URL) {
  return {
    schema: 1, baseUrl, sessionId: randomUUID(), history: [], runs: [],
  };
}

function restoredState(value) {
  if (!value || value.schema !== 1 || !Array.isArray(value.runs) || value.runs.length > MAX_RUNS ||
      !Array.isArray(value.history) || typeof value.sessionId !== "string") {
    throw new Error("This session's saved Brainstem state has an unsupported format.");
  }
  const baseUrl = normalizeBaseUrl(value.baseUrl);
  validateChatInput({
    user_input: "validate saved state",
    conversation_history: value.history,
    session_id: value.sessionId,
  });
  if (value.runs.some((run) =>
    !run || typeof run.id !== "string" || typeof run.prompt !== "string" ||
    !["running", "done", "error", "unknown"].includes(run.status) ||
    typeof run.startedAt !== "string"
  )) {
    throw new Error("This session's saved Brainstem run history has an unsupported format.");
  }
  return {
    schema: 1, baseUrl, sessionId: value.sessionId, history: value.history,
    runs: value.runs.map((run) => run.status === "running" ? {
      ...run,
      status: "unknown",
      error: "The app closed while waiting. This action may have finished on Brainstem; inspect it before retrying.",
    } : run),
  };
}

function boundedHistory(history) {
  let result = history.slice(-MAX_HISTORY_MESSAGES);
  while (result.length && result.reduce((sum, message) => sum + message.content.length, 0) > MAX_HISTORY_CHARACTERS) {
    result = result.slice(2);
  }
  return result;
}

export class FrontierWorkbench {
  constructor({ store, clientFactory = (baseUrl) => new BrainstemClient({ baseUrl }) } = {}) {
    this.store = store;
    this.clientFactory = clientFactory;
    this.saved = freshState();
    this.health = null;
    this.files = [];
    this.source = null;
    this.checkedAt = null;
    this.error = null;
    this.busy = null;
    this.listeners = new Set();
    this.controller = null;
  }

  async load() {
    if (this.store) {
      const value = await this.store.load();
      if (value) this.saved = restoredState(value);
    }
    return this.snapshot();
  }

  snapshot() {
    return structuredClone({
      baseUrl: this.saved.baseUrl,
      sessionId: this.saved.sessionId,
      runs: this.saved.runs,
      historyMessages: this.saved.history.length,
      historyLimit: MAX_HISTORY_MESSAGES,
      health: this.health,
      files: this.files,
      source: this.source,
      checkedAt: this.checkedAt,
      error: this.error,
      busy: this.busy,
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }

  async persist() {
    if (this.store) {
      try {
        await this.store.save(this.saved);
      } catch (cause) {
        throw new BrainstemError(
          "Cannot save the local session state. A completed Brainstem action is not undone; inspect its result before retrying.",
          "storage_error",
          { cause },
        );
      }
    }
  }

  async operate(kind, action) {
    if (this.busy) {
      throw new BrainstemError(`Brainstem is already ${this.busy}. Wait for it to finish first.`, "busy");
    }
    this.busy = kind;
    this.error = null;
    this.controller = new AbortController();
    this.emit();
    try {
      return await action(this.controller.signal);
    } catch (error) {
      this.error = error.message;
      throw error;
    } finally {
      this.busy = null;
      this.controller = null;
      this.emit();
    }
  }

  async connect(baseUrl = this.saved.baseUrl) {
    const normalized = normalizeBaseUrl(baseUrl);
    return this.operate("connecting", async (signal) => {
      if (normalized !== this.saved.baseUrl) {
        this.saved = freshState(normalized);
        this.files = [];
        this.source = null;
        this.health = null;
        this.checkedAt = null;
        await this.persist();
      }
      this.health = null;
      this.checkedAt = null;
      this.files = [];
      this.source = null;
      const client = this.clientFactory(normalized);
      this.health = await client.health({ signal });
      this.checkedAt = new Date().toISOString();
      this.emit();
      this.files = await client.agentFiles({ signal });
      return this.snapshot();
    });
  }

  async readSource(filename) {
    return this.operate("reading source", async (signal) => {
      if (!this.files.some((file) => file.filename === filename)) {
        throw new BrainstemError("Refresh Brainstem and choose a file from the source list.", "invalid_input");
      }
      this.source = null;
      const content = await this.clientFactory(this.saved.baseUrl).agentSource(filename, { signal });
      this.source = { filename, content };
      return this.source;
    });
  }

  async run(prompt, { signal: externalSignal } = {}) {
    validateChatInput({ user_input: prompt });
    return this.operate("running a capability", async (signal) => {
      const requestSignal = externalSignal ? AbortSignal.any([signal, externalSignal]) : signal;
      const run = {
        id: randomUUID(), prompt: prompt.trim(), status: "running",
        startedAt: new Date().toISOString(), response: "", agent_logs: "",
      };
      this.saved.runs = [...this.saved.runs, run].slice(-MAX_RUNS);
      try {
        await this.persist();
      } catch (error) {
        Object.assign(run, { status: "error", error: "Request was not sent because the local session could not be saved." });
        throw error;
      }
      this.emit();
      try {
        const result = await this.clientFactory(this.saved.baseUrl).chat({
          user_input: run.prompt,
          conversation_history: this.saved.history,
          session_id: this.saved.sessionId,
        }, { signal: requestSignal });
        Object.assign(run, result, { status: "done", finishedAt: new Date().toISOString() });
        this.saved.sessionId = result.session_id;
        this.saved.history = boundedHistory([
          ...this.saved.history,
          { role: "user", content: run.prompt },
          { role: "assistant", content: result.response },
        ]);
        await this.persist();
        return result;
      } catch (error) {
        // Persistence can fail after a successful action; do not relabel or replay it.
        if (run.status !== "done") {
          Object.assign(run, {
            status: ["timeout", "cancelled", "unreachable"].includes(error.code) ? "unknown" : "error",
            error: error.message, finishedAt: new Date().toISOString(),
          });
          await this.persist();
        }
        throw error;
      }
    });
  }

  cancel() {
    if (!this.controller || !this.busy) {
      throw new BrainstemError("There is no active request to stop waiting for.", "not_running");
    }
    this.controller.abort();
  }

  async newConversation() {
    return this.operate("starting a conversation", async () => {
      this.saved = freshState(this.saved.baseUrl);
      await this.persist();
      return this.snapshot();
    });
  }
}
