import { expect, test } from "@playwright/test";
import { renderWorkbench } from "../../lib/view.mjs";
import { previewScript } from "../../scripts/preview-bridge.mjs";

test("native controls work twice without an engine or network calls", async ({ page }) => {
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4187/")) external.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByText("Native Copilot", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("5 skill sources", { exact: true })).toBeVisible();
  await expect(page.getByText("Interactive preview.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Local Brainstem URL")).toBeHidden();
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Give me my Brainstem", exact: true }).click();
    await page.getByRole("button", { name: "Teach a new capability" }).click();
    await page.getByLabel("Copilot skill source").selectOption("example");
    await page.getByRole("button", { name: "Show source" }).click();
    await expect(page.getByLabel("Agent source code")).toContainText("teach-back");
    await page.getByRole("button", { name: "Keep this capability" }).click();
    await page.getByRole("button", { name: "Review in chat" }).click();
    await page.getByLabel("What should your Brainstem do?").fill(`Explain a concept ${i}`);
    await page.getByRole("button", { name: "Send to Copilot" }).click();
    await expect(page.getByText("Sent to Copilot chat.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Refresh skill sources" }).click();
  }
  expect(await page.evaluate(() => window.brainstemPreview.prompts.length)).toBe(10);
  expect(await page.evaluate(() => window.brainstemPreview.frontierRequests)).toBe(0);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("Frontier is opt-in and actions require review before the separate engine path", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enable Frontier", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => window.brainstemPreview.snapshot().mode)).toBe("copilot");
  await page.getByRole("dialog").getByRole("button", { name: "Enable Frontier", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Running - auth pending", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show source" }).click();
  await expect(page.getByLabel("Agent source code")).toContainText("class ExampleAgent");
  await page.getByRole("button", { name: "Open Frontier engine" }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("What should your Brainstem do?").fill(`Sample request ${i}`);
    await page.getByRole("button", { name: "Review & run" }).click();
    expect(await page.evaluate(() => window.brainstemPreview.frontierRequests)).toBe(i);
    await page.getByRole("dialog").getByRole("button", { name: "Run request", exact: true }).click();
    await expect(page.getByText("Preview result. No real engine was contacted.").first()).toBeVisible();
  }
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start new" }).click();
  await expect(page.getByText("No Frontier runs yet.")).toBeVisible();
  await page.getByRole("button", { name: "Return to native Copilot" }).click();
  await expect(page.getByLabel("Local Brainstem URL")).toBeHidden();
  await expect(page.getByRole("button", { name: "Send to Copilot" })).toBeVisible();
});

test("errors, empty state, native event metadata, and clear confirmation stay visible and honest", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.brainstemPreview.failNext("An explicit preview error"));
  await page.getByRole("button", { name: "Refresh skill sources" }).click();
  await expect(page.getByRole("alert")).toHaveText("An explicit preview error");
  await page.evaluate(() => window.brainstemPreview.failNext("Copilot did not accept this request"));
  await page.getByLabel("What should your Brainstem do?").fill("A native request");
  await page.getByRole("button", { name: "Send to Copilot" }).click();
  await expect(page.getByRole("alert")).toHaveText("Copilot did not accept this request");
  await page.evaluate(() => window.brainstemPreview.activity("read_file", "done"));
  await expect(page.getByText("read_file", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear activity" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("read_file", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear activity" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear activity", exact: true }).click();
  await expect(page.getByText("No tool activity yet.")).toBeVisible();
  await page.evaluate(() => window.brainstemPreview.empty());
  await expect(page.getByText("No skill sources discovered yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show source" })).toBeDisabled();
});

test("source is rendered as text, not active HTML", async ({ page }) => {
  await page.goto("/");
  const payload = '</pre><script>window.compromised=true</script><img src=x onerror="window.compromised=true">';
  await page.evaluate((content) => window.brainstemPreview.source(content), payload);
  await expect(page.getByLabel("Agent source code")).toHaveText(payload);
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();
});

test("the rendered view can cold-load offline and retains its native controls", async ({ context, page }) => {
  await context.setOffline(true);
  await page.route("https://offline-preview.invalid/", (route) => route.fulfill({
    contentType: "text/html", body: renderWorkbench(previewScript),
  }));
  await page.goto("https://offline-preview.invalid/");
  await page.getByRole("button", { name: "Give me my Brainstem", exact: true }).click();
  await page.getByLabel("Copilot skill source").selectOption("example");
  await page.getByRole("button", { name: "Show source" }).click();
  await expect(page.getByLabel("Agent source code")).toContainText("teach-back");
  expect(await page.evaluate(() => window.brainstemPreview.frontierRequests)).toBe(0);
});

for (const theme of ["light", "dark"]) {
  for (const width of [960, 360]) {
    test(`${theme} theme at ${width}px is usable without overflow`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/?scoutTheme=${theme}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Give me my Brainstem", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => window.brainstemPreview.prompts.length)).toBe(1);
      await page.screenshot({ path: testInfo.outputPath(`brainstem-${theme}-${width}.png`), fullPage: true });
    });
  }
}
