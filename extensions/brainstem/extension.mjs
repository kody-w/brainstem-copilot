import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { startExtension } from "../../lib/extension.mjs";

const extension = await startExtension({ CanvasError, createCanvas, joinSession });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    try {
      await extension.close();
    } catch (error) {
      await extension.session.log(`Brainstem view cleanup failed: ${error.message}`, { level: "error" });
    } finally {
      process.exit(0);
    }
  });
}
