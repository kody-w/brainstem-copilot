import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { renderWorkbench } from "./view.mjs";
import { nativeBridgeScript } from "./native-bridge.mjs";

const MAX_ACTION_BYTES = 64_000;

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readAction(request) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new Error("Canvas actions require application/json.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_ACTION_BYTES) throw new Error("Canvas action exceeds its request limit.");
    chunks.push(chunk);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (cause) {
    throw new Error("Canvas action is not valid JSON.", { cause });
  }
  if (!data || typeof data !== "object" || typeof data.action !== "string") throw new Error("A Canvas action name is required.");
  return data;
}

export async function createCanvasView(board, dispatch) {
  const key = randomBytes(32).toString("hex");
  const scriptNonce = randomBytes(18).toString("base64");
  const html = renderWorkbench(nativeBridgeScript).replaceAll("<script>", `<script nonce="${scriptNonce}">`);
  const streams = new Set();
  let origin;
  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (!response.headersSent && !response.destroyed) json(response, 400, { error: error.message });
      else response.destroy(error);
    });
  });

  async function handle(request, response) {
    if (request.headers.host !== new URL(origin).host ||
        (request.headers.origin && request.headers.origin !== origin) ||
        request.headers["sec-fetch-site"] === "cross-site") {
      json(response, 403, { error: "This Canvas only accepts its own loopback origin." });
      return;
    }
    const url = new URL(request.url, origin);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${scriptNonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      response.end(html);
      return;
    }
    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    const supplied = request.headers["x-brainstem-canvas-key"];
    if (typeof supplied !== "string" || !/^[a-f0-9]{64}$/.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(key))) {
      json(response, 403, { error: "Canvas authorization is missing. Reopen the panel from Copilot." });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      json(response, 200, board.snapshot());
    } else if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      response.write(`data: ${JSON.stringify(board.snapshot())}\n\n`);
      streams.add(response);
      response.on("close", () => streams.delete(response));
    } else if (request.method === "POST" && url.pathname === "/api/action") {
      const { action, args } = await readAction(request);
      json(response, 200, await dispatch(action, args));
    } else {
      json(response, 404, { error: "Unknown Canvas route." });
    }
  }

  const unsubscribe = board.subscribe((state) => {
    const data = `data: ${JSON.stringify(state)}\n\n`;
    for (const stream of streams) {
      if (stream.writableLength > 8 * 1024 * 1024) {
        stream.destroy();
        streams.delete(stream);
      } else {
        stream.write(data);
      }
    }
  });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
  } catch (error) {
    unsubscribe();
    throw error;
  }
  origin = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  return {
    url: `${origin}/#${key}`,
    async close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const stream of streams) stream.end();
      streams.clear();
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
