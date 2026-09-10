import { readFileSync } from "node:fs";

const template = readFileSync(new URL("../ui/workbench.html", import.meta.url), "utf8");

export function renderWorkbench(bridgeScript) {
  if (typeof bridgeScript !== "string" || !bridgeScript.trim()) {
    throw new Error("The workbench requires a native or preview bridge.");
  }
  return template.replace("/*__BRAINSTEM_BRIDGE__*/", () => bridgeScript);
}
