import assert from "node:assert/strict";
import test from "node:test";
import { startExtension } from "../lib/extension.mjs";

async function fixture(t) {
  let registered;
  let writes = 0;
  let approvals = 0;
  let allowed = false;
  let pipelineDenied = false;
  let views = 0;
  let viewClosed = 0;
  let dispatch;
  const listeners = new Map();
  const messages = [];
  const logs = [];
  const projects = [];
  const data = { soul: "Native soul", notes: [] };
  const session = {
    sessionId: "isolated-native-session",
    capabilities: { ui: { elicitation: true } },
    ui: { confirm: async () => { approvals++; return allowed; } },
    rpc: {
      metadata: { snapshot: async () => { throw new Error("A running native tool must not re-enter session metadata RPC."); } },
      canvas: { open: async ({ instanceId }) => registered.canvases[0].open({ instanceId }) },
      tools: { execute: async ({ name, arguments: args }) => {
        if (pipelineDenied) return { resultType: "denied", textResultForLlm: "Native permission denied." };
        try {
          return { resultType: "success", textResultForLlm: await registered.tools.find((item) => item.name === name).handler(args) };
        } catch (error) {
          return { resultType: "failure", textResultForLlm: error.message, error: error.message };
        }
      } },
    },
    on: (name, handler) => { listeners.set(name, handler); return () => listeners.delete(name); },
    send: async (value) => { messages.push(value); return `message-${messages.length}`; },
    log: async (message) => { logs.push(message); },
  };
  class CanvasError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const profile = {
    context: async () => structuredClone(data),
    capabilities: async () => ({ capabilities: [], warnings: [] }),
    remember: async (text) => { writes++; const note = { id: "note", text }; data.notes.push(note); return note; },
    forget: async (id) => { writes++; data.notes = data.notes.filter((note) => note.id !== id); },
    setSoul: async (text) => { writes++; data.soul = text; },
  };
  const stored = new Map();
  const extension = await startExtension({
    CanvasError,
    createCanvas: (definition) => definition,
    joinSession: async (options) => { registered = options; return session; },
  }, {
    profileFactory: (project) => { projects.push(project); return profile; },
    storeFactory: (key) => ({
      load: async () => stored.get(key) ?? null,
      save: async (state) => { stored.set(key, structuredClone(state)); },
    }),
    viewFactory: async (_board, handler) => {
      views++;
      dispatch = handler;
      return { url: "http://127.0.0.1:12345/#fixture", close: async () => { viewClosed++; } };
    },
  });
  t.after(() => extension.close());
  return {
    extension, session, messages, logs, stored, projects,
    get registered() { return registered; },
    get views() { return views; },
    get viewClosed() { return viewClosed; },
    get writes() { return writes; },
    get approvals() { return approvals; },
    allow(value) { allowed = value; },
    denyPipeline(value) { pipelineDenied = value; },
    dispatch: (...args) => dispatch(...args),
    invoke: async (name, args = {}) => JSON.parse(await registered.tools.find((item) => item.name === name).handler(args)),
    emit: (name, event) => listeners.get(name)(event),
  };
}

test("registration joins the existing session without granting blanket permissions or starting a view", async (t) => {
  const f = await fixture(t);
  assert.equal(f.views, 0);
  assert.equal(f.registered.onPermissionRequest, undefined);
  assert.equal(f.registered.hooks, undefined);
  assert.equal(f.registered.requestedEnvironmentVariables, undefined);
  assert(f.registered.tools.every((tool) => tool.skipPermission === false));
  assert.equal(f.registered.canvases[0].id, "brainstem");
  const context = await f.invoke("brainstem_context");
  assert.equal(context.mode, "copilot");
  assert.equal(f.views, 0);
  assert.equal(f.messages.length, 0);
  assert.equal(f.writes, 0);
});

test("read-only native events keep workspace identity current without prompt hooks or nested RPC", async (t) => {
  const f = await fixture(t);
  f.emit("session.context_changed", { data: { cwd: "/first-project" } });
  await f.invoke("brainstem_context");
  assert.equal(f.projects.at(-1), "/first-project");
  f.emit("session.context_changed", { data: { cwd: "/second-project" } });
  await f.extension.idle();
  await f.invoke("brainstem_refresh");
  assert.equal(f.projects.at(-1), "/second-project");
  f.emit("session.context_changed", { agentId: "subagent", data: { cwd: "/another-agent-project" } });
  await f.extension.idle();
  assert.equal(f.projects.at(-1), "/second-project");
});

test("opening the same native Canvas twice shares one managed view", async (t) => {
  const f = await fixture(t);
  await Promise.all([f.invoke("brainstem_open"), f.invoke("brainstem_open")]);
  assert.equal(f.views, 1);
  await f.dispatch("native_run", { prompt: "Do my task in Copilot" });
  assert.deepEqual(f.messages, [{ prompt: "Do my task in Copilot", mode: "enqueue" }]);
  await f.registered.canvases[0].onClose({ instanceId: "brainstem-workbench" });
  assert.equal(f.viewClosed, 1);
});

test("memory, soul, and Frontier cannot mutate without native confirmation", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.invoke("brainstem_memory", { action: "remember", text: "Use worktrees." }), { code: "declined" });
  await assert.rejects(f.invoke("brainstem_soul", { text: "# New soul" }), { code: "declined" });
  await assert.rejects(f.invoke("brainstem_mode", { mode: "frontier" }), { code: "declined" });
  assert.equal(f.writes, 0);
  assert.equal((await f.invoke("brainstem_context")).mode, "copilot");
  f.allow(true);
  await f.invoke("brainstem_memory", { action: "remember", text: "Use worktrees." });
  assert.equal(f.writes, 1);
  assert.equal(f.approvals, 4);
});

test("unsupported native elicitation fails closed", async (t) => {
  const f = await fixture(t);
  f.session.capabilities.ui.elicitation = false;
  f.allow(true);
  await assert.rejects(f.invoke("brainstem_mode", { mode: "frontier" }), { code: "approval_unavailable" });
  assert.equal(f.approvals, 0);
  assert.equal(f.writes, 0);
});

test("Canvas Frontier controls go through the native pipeline and surface denied results", async (t) => {
  const f = await fixture(t);
  await f.invoke("brainstem_open");
  f.denyPipeline(true);
  await assert.rejects(f.dispatch("mode", { mode: "frontier" }), /Native permission denied/);
  assert.equal((await f.invoke("brainstem_context")).mode, "copilot");
  f.denyPipeline(false);
  f.allow(true);
  await f.dispatch("mode", { mode: "frontier" });
  assert.equal((await f.invoke("brainstem_context")).mode, "frontier");
  await f.dispatch("mode", { mode: "copilot" });
  await assert.rejects(f.invoke("brainstem_frontier", { action: "run", prompt: "Do something" }), /Frontier is off/);
});

test("native completion events correlate with actual starts without copying tool output", async (t) => {
  const f = await fixture(t);
  await f.invoke("brainstem_context");
  f.emit("tool.execution_start", { timestamp: "2026-09-10T12:00:00Z", data: { toolCallId: "read-1", toolName: "read_file" } });
  f.emit("tool.execution_complete", { timestamp: "2026-09-10T12:00:01Z", data: {
    toolCallId: "read-1", success: false, result: { content: "not persisted" },
  } });
  await f.extension.idle();
  await f.invoke("brainstem_open");
  const state = await f.dispatch("state");
  assert.equal(state.activity[0].tool, "read_file");
  assert.equal(state.activity[0].status, "error");
  assert.equal(state.activity[0].startedAt, "2026-09-10T12:00:00Z");
  assert.equal(state.activity[0].finishedAt, "2026-09-10T12:00:01Z");
  assert.equal(JSON.stringify([...f.stored.values()]).includes("not persisted"), false);
});

test("addressing either role retains the joined session and never selects another agent", async (t) => {
  const f = await fixture(t);
  const session = f.extension.session;
  f.session.rpc.agent = { select: () => { throw new Error("No agent-picker switching"); } };
  f.emit("user.message", { data: { content: "Brainstem, help with our shared task." } });
  assert.equal((await f.invoke("brainstem_context")).role, "brainstem");
  f.emit("user.message", { data: { content: "Brain Surgeon, improve what we just did." } });
  await f.extension.idle();
  assert.equal((await f.invoke("brainstem_context")).role, "brain-surgeon");
  f.emit("user.message", { data: { content: "Continue with the same work." } });
  assert.equal((await f.invoke("brainstem_context")).role, "brain-surgeon");
  f.emit("user.message", { agentId: "other-agent", data: { content: "Brainstem, a different task." } });
  assert.equal((await f.invoke("brainstem_context")).role, "brain-surgeon");
  assert.equal(f.extension.session, session);
  assert.equal(f.messages.length, 0);
  assert.equal(f.registered.hooks, undefined);
});
