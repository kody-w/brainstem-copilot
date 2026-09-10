function previewBridge() {
  const listeners = new Set();
  const prompts = [];
  const source = "---\nname: explain-a-concept\ndescription: Explain a concept with an example and a teach-back.\n---\n\n# Explain a concept\n\n1. Ask what the learner already knows.\n2. Explain one idea with a concrete example.\n3. Invite a short teach-back and correct misunderstandings.\n";
  const skills = [
    { id: "brainstem", name: "brainstem", filename: "brainstem/SKILL.md", scope: "plugin", description: "Your native Copilot Brainstem." },
    { id: "teach", name: "brainstem-teach", filename: "brainstem-teach/SKILL.md", scope: "plugin", description: "Learn, teach, keep." },
    { id: "memory", name: "brainstem-memory", filename: "brainstem-memory/SKILL.md", scope: "plugin", description: "Soul and explicit memory." },
    { id: "example", name: "explain-a-concept", filename: "explain-a-concept/SKILL.md", scope: "project", description: "An original sample Copilot skill." },
  ];
  let state = {
    mode: "copilot",
    context: { soul: "# My Brainstem\n\nUse native Copilot tools. Teach by doing. Ask before saving notes.", customSoul: false, notes: [] },
    capabilities: skills, warnings: [], source: null, activity: [], error: null, frontier: null,
  };
  let frontierRequests = 0;
  let rejectNext = null;
  const snapshot = () => structuredClone(state);
  const emit = () => { for (const listener of listeners) listener(snapshot()); };
  const frontier = () => {
    if (state.mode !== "frontier") throw new Error("Frontier is off.");
    return state.frontier;
  };
  window.brainstemHost = {
    mode: "preview",
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async request(action, args = {}) {
      if (rejectNext) {
        const message = rejectNext;
        rejectNext = null;
        throw new Error(message);
      }
      state.error = null;
      switch (action) {
        case "state": return snapshot();
        case "refresh": emit(); return snapshot();
        case "ask":
          prompts.push({ intent: args.intent, filename: args.filename });
          return { queued: true };
        case "native_run":
          if (state.mode !== "copilot") throw new Error("Return to native Copilot.");
          prompts.push({ prompt: args.prompt });
          return { queued: true };
        case "mode":
          state.mode = args.mode;
          if (!state.frontier && args.mode === "frontier") {
            state.frontier = {
              baseUrl: "http://127.0.0.1:7071", sessionId: "preview-session",
              health: null, files: [], source: null, runs: [], busy: null, checkedAt: null, error: null,
            };
          }
          emit(); return snapshot();
        case "connect": {
          const value = frontier();
          const url = new URL(args.baseUrl);
          if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Use a loopback URL.");
          value.baseUrl = url.origin;
          value.health = { status: "ok", agents: ["ExampleAgent"], model: "preview-model", version: "sample", copilot: "pending" };
          value.files = [{ filename: "example_agent.py", agents: ["ExampleAgent"] }];
          value.checkedAt = new Date().toISOString();
          emit(); return snapshot();
        }
        case "source":
          if (state.mode === "frontier") {
            frontier().source = { filename: args.filename, content: "# Preview sample only\nclass ExampleAgent:\n    pass\n" };
          } else {
            const skill = skills.find((item) => item.id === args.id);
            if (!skill) throw new Error("Unknown skill.");
            state.source = { ...skill, content: source };
          }
          emit(); return snapshot();
        case "frontier_run": {
          const value = frontier();
          frontierRequests++;
          value.runs.push({
            id: `preview-${frontierRequests}`, prompt: args.prompt, status: "done",
            startedAt: new Date().toISOString(), response: "Preview result. No real engine was contacted.",
            agent_logs: "Sample only: ExampleAgent", model: "preview-model",
          });
          emit(); return { response: "Preview result" };
        }
        case "new":
          if (state.mode === "frontier") frontier().runs = [];
          else state.activity = [];
          emit(); return snapshot();
        case "open": frontier(); return { opened: true };
        case "cancel": frontier().busy = null; emit(); return { stoppedWaiting: true };
        default: throw new Error(`Unknown preview action: ${action}`);
      }
    },
  };
  window.brainstemPreview = {
    snapshot, prompts,
    get frontierRequests() { return frontierRequests; },
    failNext(message) { rejectNext = message; },
    activity(tool, status = "done") {
      state.activity.push({ id: `sample-${state.activity.length}`, tool, status, startedAt: new Date().toISOString() });
      emit();
    },
    source(content) {
      state.source = { ...skills[3], content };
      emit();
    },
    empty() {
      state.capabilities = [];
      state.source = null;
      emit();
    },
  };
}

export const previewScript = `(${previewBridge.toString()})();`;
