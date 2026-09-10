import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SOUL = `# My Brainstem

This is my shared Brainstem and Brain Surgeon conversation, powered by
GitHub Copilot's native agents and tools.

Help me do real work, learn from it, and keep useful capabilities as portable
Copilot skills. Brain Surgeon teaches and improves capabilities; Brainstem
uses them. I can address either role by name in this same chat without
changing agent profiles or repeating context. Show your plan, actions,
source, and evidence.

Use the current project's instructions and Copilot's normal permissions.
Ask before durable memory changes. Never store credentials or secrets.
Do not install RAPP, start a local server, or call a second model loop unless
I explicitly choose the optional Frontier engine.
`;

const MAX_SOURCE_BYTES = 256_000;
const MAX_NOTES = 100;

function contained(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function optionalFile(path, maximum = MAX_SOURCE_BYTES) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular, non-symlink file: ${basename(path)}`);
  if (info.size > maximum) throw new Error(`${basename(path)} exceeds the ${maximum}-byte source limit.`);
  return readFile(path, "utf8");
}

async function writePrivate(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function frontmatter(markdown, fallback) {
  const normalized = markdown.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return { name: fallback, description: "Source has no skill frontmatter.", warning: "missing_frontmatter" };
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return { name: fallback, description: "Source has incomplete skill frontmatter.", warning: "invalid_frontmatter" };
  const lines = normalized.slice(4, end).split("\n");
  const scalar = (key) => {
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (index < 0) return "";
    const value = lines[index].slice(key.length + 1).trim();
    if ([">", "|", ">-", "|-"].includes(value)) {
      const parts = [];
      for (let i = index + 1; i < lines.length && /^\s/.test(lines[i]); i++) parts.push(lines[i].trim());
      return parts.join(" ");
    }
    return value.replace(/^(['"])(.*)\1$/, "$2");
  };
  return { name: scalar("name") || fallback, description: scalar("description") || "No description provided in this skill's source." };
}

export class NativeProfile {
  constructor({
    home,
    copilotHome = home ? join(home, ".copilot") : process.env.COPILOT_HOME || join(homedir(), ".copilot"),
    project = process.cwd(),
    plugin = fileURLToPath(new URL("..", import.meta.url)),
  } = {}) {
    this.directory = join(copilotHome, "brainstem-app", "profile");
    this.soulPath = join(this.directory, "soul.md");
    this.memoryPath = join(this.directory, "memory.json");
    this.roots = [
      { scope: "plugin", path: join(plugin, "skills") },
      { scope: "project", path: join(project, ".github", "skills") },
      { scope: "user", path: join(copilotHome, "skills") },
    ];
    this.project = resolve(project);
  }

  async context() {
    const soul = await optionalFile(this.soulPath, 24_000);
    const raw = await optionalFile(this.memoryPath);
    let notes = [];
    if (raw !== null) {
      let data;
      try {
        data = JSON.parse(raw);
      } catch (cause) {
        throw new Error("Brainstem memory.json is invalid. Preserve and repair it; do not silently replace it.", { cause });
      }
      if (!Array.isArray(data) || data.length > MAX_NOTES || data.some((note) =>
        !note || typeof note.id !== "string" || typeof note.text !== "string" || typeof note.createdAt !== "string"
      )) throw new Error("Brainstem memory.json has an unsupported format.");
      notes = data;
    }
    return { soul: soul ?? DEFAULT_SOUL, customSoul: soul !== null, notes };
  }

  async setSoul(text) {
    if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 24_000) {
      throw new Error("The soul must contain 1 to 24000 bytes of text.");
    }
    return this.mutate(async () => {
      await writePrivate(this.soulPath, text.trim() + "\n");
      return this.context();
    });
  }

  async remember(text) {
    if (typeof text !== "string" || !text.trim() || text.length > 2_000) {
      throw new Error("A memory note must contain 1 to 2000 characters.");
    }
    return this.mutate(async () => {
      const { notes } = await this.context();
      if (notes.length >= MAX_NOTES) throw new Error("Brainstem already has 100 notes. Remove an outdated note before adding another.");
      const note = { id: randomUUID(), text: text.trim(), createdAt: new Date().toISOString() };
      await writePrivate(this.memoryPath, JSON.stringify([...notes, note], null, 2) + "\n");
      return note;
    });
  }

  async forget(id) {
    return this.mutate(async () => {
      const { notes } = await this.context();
      if (!notes.some((note) => note.id === id)) throw new Error("That Brainstem memory note does not exist.");
      await writePrivate(this.memoryPath, JSON.stringify(notes.filter((note) => note.id !== id), null, 2) + "\n");
    });
  }

  async mutate(action) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, ".profile.lock");
    let lock;
    try {
      lock = await open(path, "wx", 0o600);
    } catch (cause) {
      if (cause.code !== "EEXIST") throw cause;
      throw new Error(
        "Another Brainstem session is updating this profile. Wait for it to finish. If a prior process crashed, inspect its .profile.lock before recovering it.",
        { cause },
      );
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid }));
      return await action();
    } finally {
      await lock.close();
      await rm(path);
    }
  }

  async capabilities() {
    const capabilities = [];
    const warnings = [];
    for (const root of this.roots) {
      let entries;
      try {
        entries = await readdir(root.path, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const resolvedRoot = await realpath(root.path);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) {
          warnings.push(`Skipped symlinked skill directory: ${root.scope}/${entry.name}`);
          continue;
        }
        if (!entry.isDirectory()) continue;
        const sourcePath = join(root.path, entry.name, "SKILL.md");
        let info;
        try {
          info = await lstat(sourcePath);
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        if (!info.isFile() || info.isSymbolicLink()) {
          warnings.push(`Skipped non-regular or symlinked skill source: ${root.scope}/${entry.name}/SKILL.md`);
          continue;
        }
        if (!contained(resolvedRoot, await realpath(sourcePath))) {
          throw new Error(`Skill source escapes its configured root: ${entry.name}`);
        }
        const handle = await open(sourcePath, "r");
        let header;
        try {
          const buffer = Buffer.alloc(16_384);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          header = buffer.subarray(0, bytesRead).toString("utf8");
        } finally {
          await handle.close();
        }
        const metadata = frontmatter(header, entry.name);
        const sourceAvailable = info.size <= MAX_SOURCE_BYTES;
        if (!sourceAvailable) {
          warnings.push(`Large skill source is listed but not previewed: ${root.scope}/${entry.name}/SKILL.md. Inspect it with Copilot's native file tools.`);
        }
        capabilities.push({
          id: createHash("sha256").update(sourcePath).digest("hex").slice(0, 24),
          scope: root.scope,
          ...metadata,
          filename: `${entry.name}/SKILL.md`,
          path: sourcePath,
          sourceAvailable,
          size: info.size,
          kind: "copilot-skill",
        });
      }
    }
    return { capabilities, warnings };
  }

  async source(id) {
    const { capabilities } = await this.capabilities();
    const capability = capabilities.find((item) => item.id === id);
    if (!capability) throw new Error("Refresh the workbench and choose a discovered Copilot skill.");
    const content = await optionalFile(capability.path);
    if (content === null) throw new Error("This skill source was removed. Refresh the workbench.");
    return { ...capability, content, sha256: createHash("sha256").update(content).digest("hex") };
  }
}
