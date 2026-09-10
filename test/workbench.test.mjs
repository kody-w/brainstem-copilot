import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrainstemError } from "../lib/brainstem-client.mjs";
import { PrivateStore } from "../lib/private-store.mjs";
import { FrontierWorkbench as Workbench } from "../lib/frontier-workbench.mjs";

function memoryStore() {
  let saved = null;
  return {
    load: async () => structuredClone(saved),
    save: async (value) => { saved = structuredClone(value); },
  };
}

function client(overrides = {}) {
  return {
    health: async () => ({ status: "ok", agents: ["Example"], copilot: "pending" }),
    agentFiles: async () => [{ filename: "example_agent.py", agents: ["Example"] }],
    agentSource: async () => "# Example\n",
    chat: async () => ({ response: "Done", session_id: "engine-session", agent_logs: "Example ran" }),
    ...overrides,
  };
}

test("chat and Canvas share actual health, source, execution logs, and results", async () => {
  const board = new Workbench({ store: memoryStore(), clientFactory: () => client() });
  const states = [];
  board.subscribe((state) => states.push(state));
  await board.load();
  await board.connect();
  assert.equal(board.snapshot().health.copilot, "pending");
  await board.readSource("example_agent.py");
  assert.equal(board.snapshot().source.content, "# Example\n");
  await board.run("Run the example");
  assert.equal(board.snapshot().runs[0].status, "done");
  assert.equal(board.snapshot().runs[0].agent_logs, "Example ran");
  assert(states.some((state) => state.busy === "running a capability"));
  assert.equal(board.snapshot().busy, null);
});

test("reopening a session preserves wire history but never claims cached health is current", async () => {
  const store = memoryStore();
  let received;
  const factory = () => client({ chat: async (input) => {
    received = input;
    return { response: "Done", session_id: "engine-session", agent_logs: "" };
  } });
  const first = new Workbench({ store, clientFactory: factory });
  await first.connect();
  await first.run("First");
  const second = new Workbench({ store, clientFactory: factory });
  await second.load();
  assert.equal(second.snapshot().health, null);
  assert.equal(second.snapshot().runs.length, 1);
  await second.run("Second");
  assert.equal(received.session_id, "engine-session");
  assert.deepEqual(received.conversation_history, [
    { role: "user", content: "First" }, { role: "assistant", content: "Done" },
  ]);
});

test("a new endpoint gets a separate conversation rather than receiving the old history", async () => {
  let received;
  const board = new Workbench({ clientFactory: () => client({ chat: async (input) => {
    received = input;
    return { response: "Done", session_id: "new-session", agent_logs: "" };
  } }) });
  await board.run("Private earlier turn");
  await board.connect("http://127.0.0.1:7072");
  assert.equal(board.snapshot().runs.length, 0);
  await board.run("New server");
  assert.deepEqual(received.conversation_history, []);
});

test("only filenames returned by the engine can be read", async () => {
  const board = new Workbench({ clientFactory: () => client() });
  await assert.rejects(board.readSource("unknown_agent.py"), { code: "invalid_input" });
  assert.match(board.snapshot().error, /choose a file/);
});

test("concurrent runs and resets cannot replay or race an action", async () => {
  let finish;
  const board = new Workbench({ clientFactory: () => client({ chat: () => new Promise((resolve) => { finish = resolve; }) }) });
  const active = board.run("First");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(board.run("Second"), { code: "busy" });
  await assert.rejects(board.newConversation(), { code: "busy" });
  finish({ response: "Done", session_id: "session", agent_logs: "" });
  await active;
  assert.equal(board.snapshot().runs.length, 1);
});

test("timeout keeps an uncertain result visible and never automatically retries", async () => {
  let calls = 0;
  const board = new Workbench({ clientFactory: () => client({ chat: async () => {
    calls++;
    throw new BrainstemError("Action may still be running.", "timeout");
  } }) });
  await assert.rejects(board.run("Perform action"), { code: "timeout" });
  assert.equal(calls, 1);
  assert.equal(board.snapshot().runs[0].status, "unknown");
  assert.equal(board.snapshot().historyMessages, 0);
});

test("an interrupted persisted run remains uncertain after reopening", async () => {
  const store = memoryStore();
  const board = new Workbench({ store, clientFactory: () => client() });
  await board.run("Earlier");
  const saved = await store.load();
  saved.runs[0].status = "running";
  await store.save(saved);
  const reopened = new Workbench({ store });
  await reopened.load();
  assert.equal(reopened.snapshot().runs[0].status, "unknown");
  assert.match(reopened.snapshot().runs[0].error, /may have finished/);
});

test("a completed action stays completed if saving its result fails", async () => {
  let saves = 0;
  const store = { load: async () => null, save: async () => {
    if (++saves === 2) throw new Error("disk full");
  } };
  const board = new Workbench({ store, clientFactory: () => client() });
  await assert.rejects(board.run("Action"), { code: "storage_error" });
  assert.equal(board.snapshot().runs[0].status, "done");
  assert.match(board.snapshot().error, /not undone/);
});

test("an initial storage failure sends no request and does not leave a running action", async () => {
  let calls = 0;
  const store = { load: async () => null, save: async () => { throw new Error("disk full"); } };
  const board = new Workbench({ store, clientFactory: () => client({ chat: async () => { calls++; } }) });
  await assert.rejects(board.run("Action"), { code: "storage_error" });
  assert.equal(calls, 0);
  assert.equal(board.snapshot().runs[0].status, "error");
  assert.match(board.snapshot().runs[0].error, /not sent/);
});

test("history and run retention are bounded", async () => {
  const board = new Workbench({ clientFactory: () => client() });
  for (let i = 0; i < 23; i++) await board.run(`Turn ${i}`);
  assert.equal(board.snapshot().runs.length, 20);
  assert.equal(board.snapshot().historyMessages, 40);
  await board.newConversation();
  assert.equal(board.snapshot().runs.length, 0);
  assert.equal(board.snapshot().historyMessages, 0);
});

test("private state uses separate restrictive files and surfaces corruption", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "brainstem-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = new PrivateStore("session-one", { directory });
  const second = new PrivateStore("session-two", { directory });
  assert.notEqual(first.path, second.path);
  assert.equal(await first.load(), null);
  await first.save({ schema: 1 });
  assert.deepEqual(JSON.parse(await readFile(first.path, "utf8")), { schema: 1 });
  assert.equal(await second.load(), null);
  if (process.platform !== "win32") assert.equal((await stat(first.path)).mode & 0o777, 0o600);
  await writeFile(first.path, "not json");
  await assert.rejects(first.load(), /not valid JSON/);
});
