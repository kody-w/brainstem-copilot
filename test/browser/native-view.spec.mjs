import { expect, test } from "@playwright/test";
import { AppWorkbench } from "../../lib/app-workbench.mjs";
import { createCanvasView } from "../../lib/canvas-view.mjs";
import { dispatchAction } from "../../lib/actions.mjs";

test("the actual managed Canvas bridge queues native work and streams real controller events", async ({ page }) => {
  const sent = [];
  const errors = [];
  const board = new AppWorkbench({
    profile: {
      context: async () => ({ soul: "Native test soul", notes: [] }),
      capabilities: async () => ({ capabilities: [], warnings: [] }),
    },
    frontierFactory: () => { throw new Error("Native view attempted to initialize an external engine"); },
  });
  await board.load();
  const view = await createCanvasView(board, (action, args) => dispatchAction(board, {
    sendPrompt: async (prompt) => { sent.push(prompt); },
    openUrl: async () => { throw new Error("Native view must not open an external engine"); },
  }, action, args));
  try {
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(view.url);
    await expect(page.getByText("Native Copilot", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Interactive preview.", { exact: false })).toBeHidden();
    await page.getByRole("button", { name: "Give me my Brainstem", exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    await page.getByLabel("What should your Brainstem do?").fill("Do a real task in native chat");
    await page.getByRole("button", { name: "Send to Copilot" }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toBe("Do a real task in native chat");
    await board.toolStarted({ id: "native-tool", name: "read_file" });
    await expect(page.getByText("read_file", { exact: true })).toBeVisible();
    await board.toolFinished({ id: "native-tool", name: "read_file", isError: false });
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    expect(board.snapshot().frontier).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await view.close();
  }
});
