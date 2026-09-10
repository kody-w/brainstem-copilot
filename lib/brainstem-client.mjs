export const DEFAULT_URL = "http://127.0.0.1:7071";
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_PROMPT_LENGTH = 32_000;
export const MAX_HISTORY_MESSAGES = 40;

export class BrainstemError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = "BrainstemError";
    this.code = code;
  }
}

export function normalizeBaseUrl(value = DEFAULT_URL) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BrainstemError("Enter a loopback Brainstem URL.", "invalid_url");
  }
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new BrainstemError("Enter a complete URL, such as http://127.0.0.1:7071.", "invalid_url", { cause });
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash ||
    url.pathname !== "/"
  ) {
    throw new BrainstemError(
      "Use a loopback HTTP(S) origin only: localhost, 127.0.0.1, or [::1]. Paths, credentials, and remote hosts are not supported.",
      "invalid_url",
    );
  }
  return url.origin;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BrainstemError(`Brainstem returned an invalid ${label}.`, "invalid_response");
  }
  return value;
}

function optionalString(value, label) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new BrainstemError(`Brainstem returned an invalid ${label}.`, "invalid_response");
  }
  return value;
}

async function readLimitedText(response) {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new BrainstemError("Brainstem's response exceeded the 2 MiB limit.", "response_too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new BrainstemError("Brainstem's response exceeded the 2 MiB limit.", "response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function validateChatInput({ user_input, conversation_history = [], session_id } = {}) {
  if (typeof user_input !== "string" || !user_input.trim() || user_input.length > MAX_PROMPT_LENGTH) {
    throw new BrainstemError(`Enter a request between 1 and ${MAX_PROMPT_LENGTH} characters.`, "invalid_input");
  }
  if (!Array.isArray(conversation_history) || conversation_history.length > MAX_HISTORY_MESSAGES) {
    throw new BrainstemError(`Conversation history must contain at most ${MAX_HISTORY_MESSAGES} messages.`, "invalid_input");
  }
  const history = conversation_history.map((message) => {
    if (
      !message || !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" || message.content.length > MAX_RESPONSE_BYTES
    ) {
      throw new BrainstemError("Conversation history must contain user/assistant text messages only.", "invalid_input");
    }
    return { role: message.role, content: message.content };
  });
  if (session_id !== undefined && (typeof session_id !== "string" || !session_id.trim() || session_id.length > 200)) {
    throw new BrainstemError("The Brainstem session ID is invalid.", "invalid_input");
  }
  return {
    user_input: user_input.trim(),
    conversation_history: history,
    ...(session_id === undefined ? {} : { session_id }),
  };
}

export class BrainstemClient {
  constructor({ baseUrl = DEFAULT_URL, timeoutMs = 180_000, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
      throw new BrainstemError("Request timeout must be between 1 and 600000 milliseconds.", "invalid_input");
    }
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async request(path, { body, signal, text = false, timeoutMs = this.timeoutMs } = {}) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    let raw;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? { Accept: text ? "text/plain" : "application/json" } : {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: requestSignal,
      });
      raw = await readLimitedText(response);
    } catch (cause) {
      if (cause instanceof BrainstemError) throw cause;
      if (signal?.aborted) {
        throw new BrainstemError(
          "Stopped waiting for Brainstem. An agent action already sent may still finish on the server.",
          "cancelled",
          { cause },
        );
      }
      if (timeout.aborted) {
        throw new BrainstemError(
          "Brainstem did not respond before the timeout. A submitted action may still be running; inspect it before retrying.",
          "timeout",
          { cause },
        );
      }
      throw new BrainstemError(
        `Cannot reach Brainstem at ${this.baseUrl}. Ask Copilot to start it with "Give me my Brainstem."`,
        "unreachable",
        { cause },
      );
    }
    if (text && response.ok) return raw;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (cause) {
      throw new BrainstemError(
        `Expected Brainstem JSON, but received HTTP ${response.status} with a different response. Check the port.`,
        "invalid_response",
        { cause },
      );
    }
    requireObject(data, "response");
    if (!response.ok || data.error) {
      const message = typeof data.error === "string" ? data.error.slice(0, 2_000) : `Brainstem returned HTTP ${response.status}.`;
      throw new BrainstemError(message, data.no_copilot_access ? "no_copilot_access" : `http_${response.status}`);
    }
    return data;
  }

  async health({ signal } = {}) {
    const data = await this.request("/health", { signal, timeoutMs: Math.min(this.timeoutMs, 10_000) });
    if (!["ok", "unauthenticated"].includes(data.status) || !Array.isArray(data.agents) ||
        data.agents.some((name) => typeof name !== "string")) {
      throw new BrainstemError("This service did not return a Brainstem health response. Check the port.", "invalid_response");
    }
    return {
      status: data.status,
      agents: data.agents,
      version: optionalString(data.version, "version"),
      model: optionalString(data.model, "model"),
      copilot: optionalString(data.copilot, "Copilot status"),
      auth_error: optionalString(data.auth_error, "authentication status"),
    };
  }

  async chat(input, { signal } = {}) {
    const data = await this.request("/chat", { body: validateChatInput(input), signal });
    if (typeof data.response !== "string" || typeof data.session_id !== "string" ||
        !data.session_id || data.session_id.length > 200) {
      throw new BrainstemError("Brainstem returned an incomplete chat response.", "invalid_response");
    }
    return {
      response: data.response,
      session_id: data.session_id,
      agent_logs: optionalString(data.agent_logs, "agent log"),
      model: optionalString(data.model, "responding model"),
      requested_model: optionalString(data.requested_model, "requested model"),
    };
  }

  async agentFiles({ signal } = {}) {
    const data = await this.request("/agents", { signal, timeoutMs: Math.min(this.timeoutMs, 15_000) });
    if (!Array.isArray(data.files) || data.files.some((file) =>
      !file || !isAgentFilename(file.filename) || !Array.isArray(file.agents) ||
      file.agents.some((name) => typeof name !== "string")
    )) {
      throw new BrainstemError("Brainstem returned an invalid agent file list.", "invalid_response");
    }
    return data.files.map(({ filename, agents }) => ({ filename, agents }));
  }

  async agentSource(filename, { signal } = {}) {
    if (!isAgentFilename(filename)) {
      throw new BrainstemError("Choose a Python filename from Brainstem's agent list.", "invalid_input");
    }
    return this.request(`/agents/export/${encodeURIComponent(filename)}`, { signal, text: true });
  }
}

export function isAgentFilename(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*\.py$/.test(value) &&
    !value.includes("..") && value.length <= 200;
}
