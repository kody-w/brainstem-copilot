import { FrontierWorkbench } from "./frontier-workbench.mjs";
import { NativeProfile } from "./native-profile.mjs";

export class AppWorkbench {
  constructor({
    profile = new NativeProfile(),
    store,
    frontierFactory = () => new FrontierWorkbench(),
  } = {}) {
    this.profile = profile;
    this.store = store;
    this.frontierFactory = frontierFactory;
    this.frontier = null;
    this.mode = "copilot";
    this.context = null;
    this.capabilities = [];
    this.warnings = [];
    this.source = null;
    this.activity = [];
    this.error = null;
    this.listeners = new Set();
    this.persistence = Promise.resolve();
  }

  async load() {
    const saved = await this.store?.load();
    if (saved !== undefined && saved !== null) {
      if (saved.schema !== 1 || !Array.isArray(saved.activity) || saved.activity.length > 100 ||
          saved.activity.some((entry) => !entry || typeof entry.id !== "string" ||
            typeof entry.tool !== "string" || typeof entry.startedAt !== "string" ||
            !["running", "done", "error", "unknown"].includes(entry.status))) {
        throw new Error("The saved native workbench activity has an unsupported format.");
      }
      this.activity = saved.activity.map((entry) => entry.status === "running" ? { ...entry, status: "unknown" } : entry);
    }
    // Frontier is a deliberate per-session choice, never restored or auto-probed.
    return this.refresh();
  }

  snapshot() {
    return structuredClone({
      mode: this.mode,
      context: this.context,
      capabilities: this.capabilities,
      warnings: this.warnings,
      source: this.source,
      activity: this.activity,
      error: this.error,
      frontier: this.frontier?.snapshot() ?? null,
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

  async refresh() {
    try {
      this.error = null;
      this.context = await this.profile.context();
      const { capabilities, warnings } = await this.profile.capabilities();
      this.capabilities = capabilities;
      this.warnings = warnings;
      if (this.source) {
        const current = capabilities.find((item) => item.id === this.source.id);
        this.source = current?.sourceAvailable !== false && current ? await this.profile.source(current.id) : null;
      }
      return this.snapshot();
    } catch (error) {
      this.error = error.message;
      throw error;
    } finally {
      this.emit();
    }
  }

  async readSource(id) {
    this.source = await this.profile.source(id);
    this.emit();
    return this.source;
  }

  async setMode(mode) {
    if (!["copilot", "frontier"].includes(mode)) throw new Error("Choose copilot or frontier mode.");
    if (this.frontier?.busy) throw new Error("Wait for the active Frontier request before switching modes.");
    if (mode === "frontier" && !this.frontier) {
      this.frontier = this.frontierFactory();
      await this.frontier.load();
      this.frontier.subscribe(() => this.emit());
    }
    this.mode = mode;
    this.error = null;
    this.emit();
    return this.snapshot();
  }

  requireFrontier() {
    if (this.mode !== "frontier" || !this.frontier) {
      throw new Error("Frontier is off. Native Copilot is the default; explicitly enable Frontier before connecting an external engine.");
    }
    return this.frontier;
  }

  async saveActivity() {
    if (!this.store) return;
    const state = { schema: 1, activity: structuredClone(this.activity) };
    const prior = this.persistence;
    const operation = prior.then(() => this.store.save(state), () => this.store.save(state));
    this.persistence = operation;
    try {
      await operation;
    } catch (cause) {
      this.error = "Could not save workbench activity. The native Copilot session remains the authoritative record.";
      this.emit();
      throw new Error(this.error, { cause });
    }
  }

  async toolStarted({ id, name }) {
    if (typeof id !== "string" || !id || typeof name !== "string" || !name) throw new Error("A native tool event requires an ID and name.");
    if (name.startsWith("brainstem_") || this.activity.some((entry) => entry.id === id)) return;
    this.activity = [
      ...this.activity,
      { id, tool: name, status: "running", startedAt: new Date().toISOString() },
    ].slice(-100);
    this.emit();
    await this.saveActivity();
  }

  async toolFinished({ id, name, isError }) {
    if (typeof id !== "string" || !id || typeof name !== "string" || typeof isError !== "boolean") {
      throw new Error("A native tool result requires an ID, name, and explicit error status.");
    }
    if (name.startsWith("brainstem_")) return;
    let entry = this.activity.find((item) => item.id === id);
    if (!entry) {
      await this.toolStarted({ id, name });
      entry = this.activity.find((item) => item.id === id);
    }
    Object.assign(entry, { status: isError ? "error" : "done", finishedAt: new Date().toISOString() });
    this.emit();
    await this.saveActivity();
  }

  async clearActivity() {
    if (this.activity.some((entry) => entry.status === "running")) throw new Error("Wait for running native tools before clearing the workbench activity.");
    this.activity = [];
    this.emit();
    await this.saveActivity();
  }
}

export function nativeIntent(intent, filename) {
  if (intent === "setup") {
    return "Give me my Brainstem. Use the native Copilot brainstem skill. Stay in this Copilot session; do not install RAPP, start a server, or enable Frontier. Help me start with one real task.";
  }
  if (intent === "teach") {
    return "Brain Surgeon, help me teach my native Copilot Brainstem a reusable capability. Use brainstem-teach: learn from a real task, show the source and evidence, and keep a standard Copilot skill. Do not enable Frontier.";
  }
  if (intent === "keep" && typeof filename === "string" && filename.length <= 200 &&
      /^[A-Za-z0-9][A-Za-z0-9_. /-]*$/.test(filename)) {
    return `Help me keep and reuse the Copilot skill ${JSON.stringify(filename)}. Inspect its source, explain its current scope, and ask before copying or publishing it. Do not enable Frontier.`;
  }
  if (intent === "soul") {
    return "Help me review my Brainstem soul and explicitly approved memory notes using brainstem-memory. Do not change or save anything until I request it.";
  }
  throw new Error("Choose a supported Brainstem chat action.");
}
