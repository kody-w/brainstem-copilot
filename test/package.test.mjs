import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

test("the public marketplace references this actual installable plugin", async () => {
  const marketplace = JSON.parse(await readFile(new URL("../.github/plugin/marketplace.json", import.meta.url), "utf8"));
  const plugin = JSON.parse(await readFile(new URL("../plugin.json", import.meta.url), "utf8"));
  assert.equal(marketplace.name, "brainstem-copilot");
  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(marketplace.plugins[0].source, "./");
  assert.equal(marketplace.plugins[0].version, plugin.version);
  assert.equal(plugin.$schema, undefined);
  for (const field of ["agents", "skills", "extensions"]) {
    assert((await stat(new URL(`../${plugin[field]}`, import.meta.url))).isDirectory());
  }
  assert((await stat(new URL("../extensions/brainstem/extension.mjs", import.meta.url))).isFile());
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.version, plugin.version);
  assert.equal(packageJson.dependencies, undefined);
});

test("one agent entry exposes both same-chat roles and keeps the external engine optional", async () => {
  const agents = (await readdir(new URL("../agents/", import.meta.url))).filter((name) => name.endsWith(".agent.md"));
  assert.deepEqual(agents, ["brainstem-copilot.agent.md"]);
  for (const path of ["agents/brainstem-copilot.agent.md", "skills/brainstem/SKILL.md", "skills/brain-surgeon/SKILL.md"]) {
    const text = (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    assert.match(text, /^---\nname:/);
    assert.match(text, /native GitHub Copilot|native Copilot|native Copilot/);
    assert.match(text, /Frontier/);
  }
  for (const entry of await readdir(new URL("../skills/", import.meta.url), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const text = await readFile(new URL(`../skills/${entry.name}/SKILL.md`, import.meta.url), "utf8");
    assert.match(text, /^---\r?\nname: /);
    assert.match(text, /\r?\ndescription: /);
  }
});
