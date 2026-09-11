import { nativeIntent } from "./app-workbench.mjs";
import { isAgentFilename, MAX_PROMPT_LENGTH } from "./brainstem-client.mjs";
import { addressedPrompt, roleForPrompt } from "./roles.mjs";

export async function dispatchAction(board, host, action, args = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Workbench action arguments must be an object.");
  async function sendNative(prompt) {
    await host.sendPrompt(prompt);
    const role = roleForPrompt(prompt);
    if (role) await board.setRole(role);
  }
  switch (action) {
    case "state":
      return board.snapshot();
    case "refresh":
      return board.refresh();
    case "mode":
      return board.setMode(args.mode);
    case "source":
      return board.mode === "frontier" ?
        board.requireFrontier().readSource(args.filename) :
        board.readSource(args.id);
    case "ask": {
      if (args.intent === "keep" && board.mode === "frontier") {
        if (!isAgentFilename(args.filename)) throw new Error("Choose a Frontier Python agent source first.");
        await host.sendPrompt(`Help me keep ${JSON.stringify(args.filename)} from my explicitly enabled Frontier Brainstem. Preserve its Python source and ask where I want to export it. Do not silently translate or publish it.`);
      } else {
        await sendNative(nativeIntent(args.intent, args.filename));
      }
      return { queued: true };
    }
    case "native_run": {
      if (board.mode !== "copilot") throw new Error("Return to native Copilot before sending a native request.");
      if (typeof args.prompt !== "string" || !args.prompt.trim() || args.prompt.length > MAX_PROMPT_LENGTH) {
        throw new Error(`Enter a request between 1 and ${MAX_PROMPT_LENGTH} characters.`);
      }
      await sendNative(args.prompt.trim());
      return { queued: true };
    }
    case "native_chat":
      await sendNative(addressedPrompt(args.role, args.prompt));
      return { queued: true };
    case "connect":
      return board.requireFrontier().connect(args.baseUrl);
    case "frontier_run":
      return board.requireFrontier().run(args.prompt);
    case "cancel":
      board.requireFrontier().cancel();
      return { stoppedWaiting: true };
    case "new":
      if (board.mode === "frontier") return board.requireFrontier().newConversation();
      await board.clearActivity();
      return board.snapshot();
    case "open":
      await host.openUrl(board.requireFrontier().saved.baseUrl);
      return { queued: true };
    default:
      throw new Error(`Unsupported workbench action: ${String(action).slice(0, 80)}`);
  }
}
