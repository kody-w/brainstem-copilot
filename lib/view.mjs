import { readFileSync } from "node:fs";
import { roleForPrompt } from "./roles.mjs";

const template = readFileSync(new URL("../ui/workbench.html", import.meta.url), "utf8");
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export function renderWorkbench(bridgeScript) {
  if (typeof bridgeScript !== "string" || !bridgeScript.trim()) {
    throw new Error("The workbench requires a native or preview bridge.");
  }
  return template
    .replaceAll("__BRAINSTEM_VERSION__", version)
    .replace("/*__BRAINSTEM_BRIDGE__*/", () => `window.brainstemRoleForPrompt = ${roleForPrompt.toString()};\n${bridgeScript}`);
}
