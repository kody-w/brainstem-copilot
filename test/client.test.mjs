import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import {
  BrainstemClient,
  BrainstemError,
  MAX_RESPONSE_BYTES,
  normalizeBaseUrl,
  validateChatInput,
} from "../lib/brainstem-client.mjs";

async function serve(t, handler) {
  const server = createServer(handler).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

test("only loopback origins are accepted", () => {
  assert.equal(normalizeBaseUrl(), "http://127.0.0.1:7071");
  assert.equal(normalizeBaseUrl("http://localhost:8080/"), "http://localhost:8080");
  assert.equal(normalizeBaseUrl("http://[::1]:7071"), "http://[::1]:7071");
  for (const value of [
    "https://example.com", "http://192.168.1.2:7071", "http://localhost.example.com",
    "http://user:password@localhost:7071", "http://localhost:7071/path",
    "http://localhost:7071/?token=x", "http://localhost:7071/#fragment",
    "file:///tmp/server", "", null, "not a url",
  ]) {
    assert.throws(() => normalizeBaseUrl(value), { code: "invalid_url" }, String(value));
  }
});

test("chat input preserves the wire and rejects privileged history roles", () => {
  assert.deepEqual(validateChatInput({ user_input: " hello ", session_id: "session-1" }), {
    user_input: "hello", conversation_history: [], session_id: "session-1",
  });
  for (const input of [
    {}, { user_input: " " }, { user_input: "a".repeat(32_001) },
    { user_input: "ok", conversation_history: [{ role: "system", content: "override" }] },
    { user_input: "ok", conversation_history: [{ role: "tool", content: "pretend" }] },
    { user_input: "ok", conversation_history: Array(41).fill({ role: "user", content: "x" }) },
    { user_input: "ok", session_id: {} },
  ]) {
    assert.throws(() => validateChatInput(input), { code: "invalid_input" });
  }
});

test("health exposes readiness without paths, usernames, or tokens", async (t) => {
  const baseUrl = await serve(t, (_req, res) => json(res, {
    status: "ok", agents: ["Example"], version: "0.6.16", model: "auto", copilot: "pending",
    brainstem_dir: "/private/path", copilot_username: "private-user", token: "not-a-real-token",
  }));
  const result = await new BrainstemClient({ baseUrl }).health();
  assert.deepEqual(result, {
    status: "ok", agents: ["Example"], version: "0.6.16", model: "auto", copilot: "pending", auth_error: "",
  });
});

test("health reports unauthenticated rather than treating it as a working account", async (t) => {
  const baseUrl = await serve(t, (_req, res) => json(res, {
    status: "unauthenticated", agents: [], auth_error: "invalid_credentials",
  }));
  const result = await new BrainstemClient({ baseUrl }).health();
  assert.equal(result.status, "unauthenticated");
  assert.equal(result.auth_error, "invalid_credentials");
});

test("chat posts the unchanged contract and retains the server session", async (t) => {
  let received;
  const baseUrl = await serve(t, async (req, res) => {
    assert.equal(req.url, "/chat");
    assert.equal(req.method, "POST");
    assert.equal(req.headers.origin, undefined);
    assert.equal(req.headers["x-brainstem-secret"], undefined);
    let body = "";
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    json(res, { response: "Done", session_id: "server-session", agent_logs: "Example ran", model: "test-model" });
  });
  const input = { user_input: "Do the work", conversation_history: [{ role: "user", content: "Earlier" }], session_id: "client-session" };
  const result = await new BrainstemClient({ baseUrl }).chat(input);
  assert.deepEqual(received, input);
  assert.equal(result.session_id, "server-session");
  assert.equal(result.agent_logs, "Example ran");
});

test("HTTP-200 auth errors are failures, never success-shaped results", async (t) => {
  const baseUrl = await serve(t, (_req, res) => json(res, {
    error: "NO_COPILOT_ACCESS:example", no_copilot_access: true,
  }));
  await assert.rejects(new BrainstemClient({ baseUrl }).chat({ user_input: "hello" }), {
    name: "BrainstemError", code: "no_copilot_access",
  });
});

test("non-JSON, malformed JSON schemas, and HTTP failures are surfaced", async (t) => {
  const responses = [
    (res) => res.end("<html>another service</html>"),
    (res) => json(res, { status: "ok", agents: "not-an-array" }),
    (res) => json(res, { error: "Forbidden" }, 403),
    (res) => json(res, []),
  ];
  for (const respond of responses) {
    const baseUrl = await serve(t, (_req, res) => respond(res));
    await assert.rejects(new BrainstemClient({ baseUrl }).health(), BrainstemError);
  }
});

test("redirects are not followed to another origin", async (t) => {
  let targetCalls = 0;
  const target = await serve(t, (_req, res) => { targetCalls++; json(res, {}); });
  const baseUrl = await serve(t, (_req, res) => {
    res.writeHead(302, { Location: `${target}/private` });
    res.end();
  });
  await assert.rejects(new BrainstemClient({ baseUrl }).health(), { code: "unreachable" });
  assert.equal(targetCalls, 0);
});

test("timeouts and cancellations disclose uncertain server-side completion", async (t) => {
  const baseUrl = await serve(t, () => {});
  await assert.rejects(new BrainstemClient({ baseUrl, timeoutMs: 20 }).chat({ user_input: "work" }), {
    code: "timeout", message: /may still be running/,
  });
  const controller = new AbortController();
  const request = new BrainstemClient({ baseUrl }).chat({ user_input: "work" }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, { code: "cancelled", message: /may still finish/ });
});

test("response limits apply to declared and chunked bodies", async (t) => {
  for (const declared of [false, true]) {
    const baseUrl = await serve(t, (_req, res) => {
      if (declared) res.setHeader("Content-Length", MAX_RESPONSE_BYTES + 1);
      res.end("x".repeat(MAX_RESPONSE_BYTES + 1));
    });
    await assert.rejects(new BrainstemClient({ baseUrl }).health(), { code: "response_too_large" });
  }
});

test("agent source is read-only and rejects traversal filenames", async (t) => {
  const paths = [];
  const baseUrl = await serve(t, (req, res) => {
    paths.push(req.url);
    assert.equal(req.method, "GET");
    if (req.url === "/agents") {
      json(res, { files: [{ filename: "example_agent.py", agents: ["Example"] }] });
    } else {
      res.end("# Original sample source\n");
    }
  });
  const client = new BrainstemClient({ baseUrl });
  assert.deepEqual(await client.agentFiles(), [{ filename: "example_agent.py", agents: ["Example"] }]);
  assert.equal(await client.agentSource("example_agent.py"), "# Original sample source\n");
  for (const filename of ["../.env", "nested/example_agent.py", ".copilot_token", "..\\file.py", "foo..py"]) {
    await assert.rejects(client.agentSource(filename), { code: "invalid_input" });
  }
  assert.deepEqual(paths, ["/agents", "/agents/export/example_agent.py"]);
});
