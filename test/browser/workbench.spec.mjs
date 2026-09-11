import { expect, test } from "@playwright/test";
import { renderWorkbench } from "../../lib/view.mjs";
import { previewScript } from "../../scripts/preview-bridge.mjs";

async function drawer(page, tab = "Capabilities") {
  if (!await page.getByRole("dialog", { name: "Shared workbench" }).isVisible()) {
    await page.getByRole("button", { name: "Open capabilities", exact: true }).click();
  }
  await page.getByRole("tab", { name: tab, exact: true }).click();
}

test("reference layout has two simultaneous chat panes with bottom-anchored composers", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto("/");
  const left = await page.locator("#brainstem-pane").boundingBox();
  const right = await page.locator("#surgeon-pane").boundingBox();
  expect(left.width / 1280).toBeGreaterThan(0.6);
  expect(left.width / 1280).toBeLessThan(0.67);
  expect(Math.abs(right.x - left.width)).toBeLessThan(2);
  for (const id of ["brainstem-pane", "surgeon-pane"]) {
    const pane = await page.locator(`#${id}`).boundingBox();
    const footer = await page.locator(`#${id} .composer-area`).boundingBox();
    expect(Math.abs(pane.y + pane.height - footer.y - footer.height)).toBeLessThan(2);
  }
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  await expect(page.getByLabel("Local Brainstem URL")).toBeHidden();
});

test("both composers show chat bubbles in the same workspace without an engine", async ({ page }) => {
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4187/")) external.push(request.url());
  });
  await page.goto("/");
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("Message Brainstem", { exact: true }).fill(`Use our shared capability ${i}`);
    await page.getByRole("button", { name: "Send to Brainstem", exact: true }).click();
    await expect(page.getByRole("log", { name: "Brainstem messages" })).toContainText(`Use our shared capability ${i}`);
    await page.getByLabel("Message Brain Surgeon", { exact: true }).fill(`Improve that capability ${i}`);
    await page.getByRole("button", { name: "Send to Brain Surgeon", exact: true }).click();
    await expect(page.getByRole("log", { name: "Brain Surgeon messages" })).toContainText(`Improve that capability ${i}`);
  }
  await expect(page.getByLabel("Message Brainstem", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Message Brain Surgeon", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => window.brainstemPreview.prompts.length)).toBe(4);
  expect(await page.evaluate(() => window.brainstemPreview.frontierRequests)).toBe(0);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("toolbar drawers retain sources, shared memory, refresh, and native teaching actions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Give me my Brainstem", exact: true }).click();
  await drawer(page);
  await expect(page.getByText("5 skill sources", { exact: true })).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("Copilot skill source").selectOption("example");
    await page.getByRole("button", { name: "Show source", exact: true }).click();
    await expect(page.getByLabel("Agent source code")).toContainText("teach-back");
    await page.getByRole("button", { name: "Refresh skill sources" }).click();
  }
  await page.getByRole("button", { name: "Keep this capability" }).click();
  await expect(page.getByRole("dialog", { name: "Shared workbench" })).toBeHidden();
  await page.getByRole("button", { name: "Open soul and memory" }).click();
  await expect(page.getByLabel("Shared soul")).toContainText("native Copilot tools");
  await page.getByRole("button", { name: "Review in chat" }).click();
  await page.getByRole("button", { name: "Import skill", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Get help", exact: true }).click();
  await page.getByRole("button", { name: "Refresh conversation" }).click();
  expect(await page.evaluate(() => window.brainstemPreview.prompts.map((item) => item.intent))).toEqual(["setup", "keep", "soul", "import", "export", "help"]);
});

test("Frontier stays explicit and never takes over the Surgeon composer", async ({ page }) => {
  await page.goto("/");
  await drawer(page, "Frontier");
  await page.getByRole("button", { name: "Enable Frontier", exact: true }).click();
  expect(await page.evaluate(() => window.brainstemPreview.snapshot().mode)).toBe("copilot");
  await page.getByRole("dialog", { name: "Enable optional Frontier?" }).getByRole("button", { name: "Enable Frontier" }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Engine running; Copilot authorization is pending its first request.")).toBeVisible();
  await page.getByRole("button", { name: "Open Frontier engine" }).click();
  await page.getByRole("tab", { name: "Capabilities", exact: true }).click();
  await page.getByRole("button", { name: "Show source", exact: true }).click();
  await expect(page.getByLabel("Agent source code")).toContainText("class ExampleAgent");
  await page.getByRole("button", { name: "Close workbench" }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("Message Brainstem", { exact: true }).fill(`External request ${i}`);
    await page.getByRole("button", { name: "Send to Brainstem", exact: true }).click();
    expect(await page.evaluate(() => window.brainstemPreview.frontierRequests)).toBe(i);
    await page.getByRole("dialog").getByRole("button", { name: "Run request", exact: true }).click();
    await expect(page.getByRole("log", { name: "Brainstem messages" })).toContainText("No real engine was contacted.");
  }
  await page.getByLabel("Message Brain Surgeon", { exact: true }).fill("Explain our work in Copilot");
  await page.getByRole("button", { name: "Send to Brain Surgeon", exact: true }).click();
  expect(await page.evaluate(() => window.brainstemPreview.frontierRequests)).toBe(2);
  await expect(page.getByRole("log", { name: "Brain Surgeon messages" })).toContainText("Explain our work in Copilot");
  await drawer(page, "Activity");
  await page.getByRole("button", { name: "New Frontier conversation" }).click();
  await page.getByRole("dialog", { name: "Start a new Frontier conversation?" }).getByRole("button", { name: "Start new" }).click();
  await expect(page.getByText("No Frontier runs yet.")).toBeVisible();
  await page.getByRole("tab", { name: "Frontier", exact: true }).click();
  await page.getByRole("button", { name: "Return to native Copilot" }).click();
  await expect(page.getByLabel("Local Brainstem URL")).toBeHidden();
});

test("clear-view, collapse, and role addressing preserve the underlying shared conversation", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Message Brainstem", { exact: true }).fill("Left message");
  await page.getByRole("button", { name: "Send to Brainstem", exact: true }).click();
  await page.getByLabel("Message Brain Surgeon", { exact: true }).fill("Right message");
  await page.getByRole("button", { name: "Send to Brain Surgeon", exact: true }).click();
  const count = await page.evaluate(() => window.brainstemPreview.snapshot().conversation.messages.length);
  await page.getByRole("button", { name: "Hide Brain Surgeon pane" }).click();
  await expect(page.getByLabel("Message Brain Surgeon", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Show Brain Surgeon pane" }).click();
  await expect(page.getByRole("log", { name: "Brain Surgeon messages" })).toContainText("Right message");
  await page.getByRole("button", { name: "Clear view", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear view", exact: true }).click();
  await expect(page.getByRole("log", { name: "Brainstem messages" })).not.toContainText("Left message");
  await expect(page.getByRole("log", { name: "Brain Surgeon messages" })).toContainText("Right message");
  expect(await page.evaluate(() => window.brainstemPreview.snapshot().conversation.messages.length)).toBe(count);
  await page.getByLabel("Message Brainstem", { exact: true }).fill("Brain Surgeon, answer from this box");
  await page.getByRole("button", { name: "Send to Brainstem", exact: true }).click();
  await expect(page.getByRole("log", { name: "Brain Surgeon messages" })).toContainText("answer from this box");
});

test("errors remain visible, drafts survive rejection, and message HTML stays inert", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Message Brainstem", { exact: true }).fill("Earlier accepted message");
  await page.getByRole("button", { name: "Send to Brainstem", exact: true }).click();
  await expect(page.locator("#brainstem-queue")).toContainText("Sent to the same Copilot conversation");
  await page.evaluate(() => window.brainstemPreview.failNext("Copilot did not accept this request"));
  await page.getByLabel("Message Brainstem", { exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Send to Brainstem", exact: true }).click();
  await expect(page.locator("#error")).toHaveText("Copilot did not accept this request");
  await expect(page.getByLabel("Message Brainstem", { exact: true })).toHaveValue("Keep this draft");
  await expect(page.locator("#brainstem-queue")).toHaveText("");
  await page.evaluate(() => window.brainstemPreview.activity("an unrelated native update"));
  await expect(page.locator("#error")).toHaveText("Copilot did not accept this request");
  const payload = '<img src=x onerror="window.compromised=true">';
  await page.evaluate((content) => window.brainstemPreview.messages([{ id: "unsafe", role: "brainstem", author: "assistant", content }]), payload);
  await expect(page.getByRole("log", { name: "Brainstem messages" })).toContainText(payload);
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();
  await drawer(page);
  await page.evaluate((content) => window.brainstemPreview.source(content), payload);
  await expect(page.getByLabel("Agent source code")).toHaveText(payload);
  await page.evaluate(() => window.brainstemPreview.empty());
  await expect(page.getByText("No skill sources discovered yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show source", exact: true })).toBeDisabled();
});

test("the delivered view cold-loads offline with both composers", async ({ context, page }) => {
  await context.setOffline(true);
  await page.route("https://offline-preview.invalid/", (route) => route.fulfill({ contentType: "text/html", body: renderWorkbench(previewScript) }));
  await page.goto("https://offline-preview.invalid/");
  await page.getByLabel("Message Brainstem", { exact: true }).fill("Offline preview message");
  await page.getByRole("button", { name: "Send to Brainstem", exact: true }).click();
  await page.getByLabel("Message Brain Surgeon", { exact: true }).fill("Same offline preview");
  await page.getByRole("button", { name: "Send to Brain Surgeon", exact: true }).click();
  await expect(page.getByRole("log", { name: "Brain Surgeon messages" })).toContainText("Same offline preview");
  expect(await page.evaluate(() => window.brainstemPreview.frontierRequests)).toBe(0);
});

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 360]) {
    test(`${theme} split-chat layout at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?scoutTheme=${theme}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Toggle Canvas theme" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme === "dark" ? "light" : "dark");
      await page.keyboard.press("Enter");
      await page.getByLabel("Message Brainstem", { exact: true }).fill("A keyboard message");
      await page.getByLabel("Message Brainstem", { exact: true }).press("Enter");
      await expect(page.getByRole("log", { name: "Brainstem messages" })).toContainText("A keyboard message");
      await page.getByLabel("Message Brain Surgeon", { exact: true }).fill("Another line");
      await page.getByLabel("Message Brain Surgeon", { exact: true }).press("Shift+Enter");
      expect(await page.getByLabel("Message Brain Surgeon", { exact: true }).inputValue()).toContain("\n");
      await page.screenshot({ path: testInfo.outputPath(`split-${theme}-${width}.png`), fullPage: true });
    });
  }
}
