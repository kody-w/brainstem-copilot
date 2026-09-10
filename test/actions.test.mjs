import assert from "node:assert/strict";
import test from "node:test";
import { AppWorkbench } from "../lib/app-workbench.mjs";
import { dispatchAction } from "../lib/actions.mjs";

function fixture() {
  const prompts = [];
  const opened = [];
  let requests = 0;
  const frontier = {
    saved: { baseUrl: "http://127.0.0.1:7071" },
    load: async () => {}, subscribe: () => {}, snapshot: () => ({}),
    connect: async () => { requests++; return {}; },
    run: async () => { requests++; return { response: "real adapter result" }; },
  };
  const board = new AppWorkbench({
    profile: {
      context: async () => ({ soul: "native", notes: [] }),
      capabilities: async () => ({ capabilities: [], warnings: [] }),
    },
    frontierFactory: () => frontier,
  });
  return {
    board, prompts, opened, get requests() { return requests; },
    host: {
      sendPrompt: async (prompt) => { prompts.push(prompt); },
      openUrl: async (url) => { opened.push(url); },
    },
  };
}

test("native actions queue one ordinary Copilot message, not a hidden model or engine call", async () => {
  const f = fixture();
  await f.board.load();
  assert.deepEqual(await dispatchAction(f.board, f.host, "native_run", { prompt: "Do real work" }), { queued: true });
  await dispatchAction(f.board, f.host, "ask", { intent: "setup" });
  assert.equal(f.prompts.length, 2);
  assert.equal(f.prompts[0], "Do real work");
  assert.match(f.prompts[1], /Stay in this Copilot session/);
  assert.equal(f.requests, 0);
});

test("every external-engine action is rejected before an explicit mode choice", async () => {
  const f = fixture();
  for (const action of ["connect", "frontier_run", "open", "cancel"]) {
    await assert.rejects(dispatchAction(f.board, f.host, action, { prompt: "work" }), /Frontier is off/);
  }
  assert.equal(f.requests, 0);
  await dispatchAction(f.board, f.host, "mode", { mode: "frontier" });
  assert.equal(f.requests, 0);
  await dispatchAction(f.board, f.host, "connect");
  assert.equal(f.requests, 1);
  await dispatchAction(f.board, f.host, "frontier_run", { prompt: "work" });
  assert.equal(f.requests, 2);
  await dispatchAction(f.board, f.host, "mode", { mode: "copilot" });
  await assert.rejects(dispatchAction(f.board, f.host, "connect"), /Frontier is off/);
});

test("the view cannot write soul or memory through its message bridge", async () => {
  const f = fixture();
  for (const action of ["remember", "setSoul", "exec", "writeFile", "install"]) {
    await assert.rejects(dispatchAction(f.board, f.host, action), /Unsupported/);
  }
  await assert.rejects(dispatchAction(f.board, f.host, "native_run", { prompt: " " }), /Enter a request/);
  assert.equal(f.prompts.length, 0);
});
