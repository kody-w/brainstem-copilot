import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export class PrivateStore {
  constructor(sessionKey, { directory = join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "brainstem-app", "sessions") } = {}) {
    if (typeof sessionKey !== "string" || !sessionKey) {
      throw new Error("A Copilot session key is required to isolate Brainstem history.");
    }
    this.directory = directory;
    const key = createHash("sha256").update(sessionKey).digest("hex");
    this.path = join(directory, `${key}.json`);
  }

  async load() {
    let raw;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error(`Cannot read this session's local Brainstem state: ${error.message}`, { cause: error });
    }
    try {
      return JSON.parse(raw);
    } catch (cause) {
      throw new Error("This session's local Brainstem state is not valid JSON. Preserve the file before repairing it.", { cause });
    }
  }

  async save(state) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
