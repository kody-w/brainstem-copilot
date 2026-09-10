import assert from "node:assert/strict";
import test from "node:test";
import { AppWorkbench } from "../lib/app-workbench.mjs";
import { dispatchAction } from "../lib/actions.mjs";
import { roleForPrompt } from "../lib/roles.mjs";

function fixture(saved = null) {
  let persisted = saved;
  const store = {
    load: async () => structuredClone(persisted),
    save: async (value) => { persisted = structuredClone(value); },
  };
  const profile = {
    context: async () => ({ soul: "Shared soul", notes: [{ id: "note", text: "Shared note" }] }),
    capabilities: async () => ({ capabilities: [{ id: "skill", name: "shared-skill" }], warnings: [] }),
  };
  const board = new AppWorkbench({
    profile, store,
    frontierFactory: () => { throw new Error("Role changes must not initialize Frontier"); },
  });
  return { board, profile, store };
}

test("explicit same-chat addresses resolve without confusing Frontier or quoted discussion", () => {
  for (const prompt of ["Brainstem, do this", "brainstem: hello", "@Brainstem help", "/brainstem explain", "Brainstem"]) {
    assert.equal(roleForPrompt(prompt), "brainstem", prompt);
  }
  for (const prompt of ["Brain Surgeon, teach this", "Brainsurgeon, help", "Surgeon: explain", "/brain-surgeon help", "BRAIN SURGEON"]) {
    assert.equal(roleForPrompt(prompt), "brain-surgeon", prompt);
  }
  for (const prompt of ["Discuss Brainstem and Brain Surgeon", "brainstem-frontier", "/brainstem-memory", "Brainstem Copilot is installed", "> Brainstem, quoted example", "", null]) {
    assert.equal(roleForPrompt(prompt), null, String(prompt));
  }
});

test("role changes preserve one shared profile, capabilities, source, and activity", async () => {
  const { board, profile } = fixture();
  await board.load();
  board.source = { id: "skill", filename: "shared/SKILL.md", content: "Shared source" };
  await board.toolStarted({ id: "work", name: "read_file" });
  await board.toolFinished({ id: "work", name: "read_file", isError: false });
  const before = board.snapshot();
  for (const role of ["brainstem", "brain-surgeon", "brainstem", "brain-surgeon"]) {
    await board.setRole(role);
    const state = board.snapshot();
    assert.equal(state.role, role);
    assert.equal(state.mode, "copilot");
    assert.equal(state.frontier, null);
    assert.equal(board.profile, profile);
    for (const key of ["context", "capabilities", "source", "activity"]) assert.deepEqual(state[key], before[key]);
  }
});

test("role choice persists for the same session and supports older activity files", async () => {
  const f = fixture({ schema: 1, activity: [] });
  assert.equal((await f.board.load()).role, "brain-surgeon");
  await f.board.setRole("brainstem");
  const resumed = new AppWorkbench({ profile: f.profile, store: f.store });
  assert.equal((await resumed.load()).role, "brainstem");
  await resumed.clearActivity();
  assert.equal(resumed.snapshot().role, "brainstem");
  const invalid = fixture({ schema: 1, activity: [], role: "external-server" });
  await assert.rejects(invalid.board.load(), /unsupported/);
});

test("both Canvas role buttons enqueue messages to the same host without profile selection", async () => {
  const { board } = fixture();
  await board.load();
  const messages = [];
  const host = { sendPrompt: async (prompt) => { messages.push(prompt); } };
  for (const role of ["brainstem", "brain-surgeon", "brainstem", "brain-surgeon"]) {
    await dispatchAction(board, host, "ask", { intent: role });
    assert.equal(board.snapshot().role, role);
  }
  assert.equal(messages.length, 4);
  assert(messages.every((prompt) => prompt.includes("same chat") && prompt.includes("without changing")));
  assert.equal(board.snapshot().frontier, null);
});

test("a rejected native message does not change the addressed role", async () => {
  const { board } = fixture();
  await board.load();
  await assert.rejects(dispatchAction(board, {
    sendPrompt: async () => { throw new Error("Native message rejected"); },
  }, "ask", { intent: "brainstem" }), /rejected/);
  assert.equal(board.snapshot().role, "brain-surgeon");
});
