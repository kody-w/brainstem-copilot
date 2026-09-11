import { expect, test } from "@playwright/test";
import { AppWorkbench } from "../../lib/app-workbench.mjs";
import { createCanvasView } from "../../lib/canvas-view.mjs";
import { dispatchAction } from "../../lib/actions.mjs";
import { roleForPrompt } from "../../lib/roles.mjs";

test("the real Canvas bridge renders both native reply streams in one shared workspace", async ({ page }) => {
  const sent = [];
  const errors = [];
  const board = new AppWorkbench({
    profile: {
      context: async () => ({ soul: "Shared native soul", notes: [] }),
      capabilities: async () => ({ capabilities: [], warnings: [] }),
    },
    frontierFactory: () => { throw new Error("Native chat must not initialize an external engine"); },
  });
  await board.load();
  let sequence = 0;
  const event = (type, data) => ({ id: `event-${++sequence}`, type, timestamp: new Date().toISOString(), data });
  const view = await createCanvasView(board, (action, args) => dispatchAction(board, {
    sendPrompt: async (prompt) => {
      const index = sent.push(prompt);
      const role = roleForPrompt(prompt);
      board.receiveChatEvent(event("user.message", { messageId: `user-${index}`, content: prompt, interactionId: String(index) }));
      board.receiveChatEvent(event("assistant.turn_start", { turnId: "0", interactionId: String(index), model: "native-fixture-model" }));
      board.receiveChatEvent(event("assistant.message_start", { messageId: `answer-${index}`, phase: "final_answer" }));
      board.receiveChatEvent(event("assistant.message_delta", { messageId: `answer-${index}`, deltaContent: "Streaming fixture reply" }));
      board.receiveChatEvent(event("assistant.message", { messageId: `answer-${index}`, content: `${role === "brainstem" ? "**Brainstem:**" : "**Brain Surgeon:**"} Shared fixture reply ${index}`, interactionId: String(index), phase: "final_answer" }));
      board.receiveChatEvent(event("session.idle", {}));
    },
    openUrl: async () => { throw new Error("No engine should be opened"); },
  }, action, args));
  try {
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(view.url);
    await expect(page.getByText("Interactive preview.", { exact: false })).toBeHidden();
    for (let i = 0; i < 2; i++) {
      await page.getByLabel("Message Brainstem", { exact: true }).fill(`Task ${i}`);
      await page.getByRole("button", { name: "Send to Brainstem", exact: true }).click();
      await expect(page.getByRole("log", { name: "Brainstem messages" })).toContainText(`Shared fixture reply ${2 * i + 1}`);
      await page.getByLabel("Message Brain Surgeon", { exact: true }).fill(`Improve task ${i}`);
      await page.getByRole("button", { name: "Send to Brain Surgeon", exact: true }).click();
      await expect(page.getByRole("log", { name: "Brain Surgeon messages" })).toContainText(`Shared fixture reply ${2 * i + 2}`);
    }
    expect(sent).toEqual(["Brainstem, Task 0", "Brain Surgeon, Improve task 0", "Brainstem, Task 1", "Brain Surgeon, Improve task 1"]);
    expect(board.snapshot().conversation.messages.length).toBe(8);
    expect(board.snapshot().frontier).toBeNull();
    expect(board.snapshot().context.soul).toBe("Shared native soul");
    await expect(page.locator("#model-label")).toHaveText("native-fixture-model");
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await view.close();
  }
});
