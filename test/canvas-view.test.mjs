import assert from "node:assert/strict";
import test from "node:test";
import { createCanvasView } from "../lib/canvas-view.mjs";

test("managed Canvas transport requires its per-panel key and same origin", async (t) => {
  const listeners = new Set();
  let calls = 0;
  const board = {
    snapshot: () => ({ mode: "copilot", privateNote: "fixture-only" }),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const view = await createCanvasView(board, async () => { calls++; return { queued: true }; });
  t.after(() => view.close());
  const url = new URL(view.url);
  const origin = url.origin;
  const key = url.hash.slice(1);
  const headers = { "X-Brainstem-Canvas-Key": key };
  const page = await fetch(origin);
  const html = await page.text();
  assert.equal(html.includes(key), false);
  assert.equal(html.includes("fixture-only"), false);
  assert.match(page.headers.get("content-security-policy"), /script-src 'nonce-/);
  assert.equal((await fetch(`${origin}/api/state`)).status, 403);
  assert.equal((await fetch(`${origin}/api/state`, { headers: { ...headers, Origin: "https://untrusted.example" } })).status, 403);
  assert.deepEqual(await (await fetch(`${origin}/api/state`, { headers })).json(), board.snapshot());
  assert.equal((await fetch(`${origin}/api/action`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "native_run" }),
  })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await fetch(`${origin}/api/action`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "native_run", args: { prompt: "An explicit user task" } }),
  })).status, 200);
  assert.equal(calls, 1);
  await view.close();
  assert.equal(listeners.size, 0);
  await assert.rejects(fetch(`${origin}/api/state`, { headers }));
});

test("managed Canvas action failures are error responses, never successful receipts", async (t) => {
  const view = await createCanvasView({
    snapshot: () => ({ mode: "copilot" }), subscribe: () => () => {},
  }, async () => { throw new Error("Native approval declined"); });
  t.after(() => view.close());
  const url = new URL(view.url);
  const result = await fetch(`${url.origin}/api/action`, {
    method: "POST", headers: { "X-Brainstem-Canvas-Key": url.hash.slice(1), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mode", args: { mode: "frontier" } }),
  });
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: "Native approval declined" });
});
