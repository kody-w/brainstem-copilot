import { createServer } from "node:http";
import { renderWorkbench } from "../lib/view.mjs";
import { previewScript } from "./preview-bridge.mjs";

const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex < 0 ? 4173 : process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Use a port between 1 and 65535.");
const html = renderWorkbench(previewScript);
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (req.method !== "GET") {
    res.writeHead(405).end();
  } else if (path === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(html);
  } else if (path === "/favicon.ico") {
    res.writeHead(204).end();
  } else {
    res.writeHead(404).end("Not found");
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Brainstem UI preview: http://127.0.0.1:${port} (sample data; no server or agents are run)`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close());
}
