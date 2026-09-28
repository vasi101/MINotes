import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

async function chooseAction(page: Page, name: string) {
  const card = page.getByRole("region", { name: "Kitty answer" });
  await card.getByLabel("AI actions", { exact: true }).click();
  await card.getByRole("button", { name, exact: true }).click();
}

test("selection popup is an action-only list and Ask AI opens an idle composer", async ({
  page,
}) => {
  const calls = await fixtures(page);
  await selectNote(page);
  const menu = page.getByRole("region", { name: "Selection menu" });
  await expect(menu.getByRole("textbox")).toHaveCount(0);
  await expect(menu.getByRole("combobox")).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "Web search" })).toHaveCount(0);
  expect(
    await menu.locator(".kitty-action-list button").allTextContents(),
  ).toHaveLength(6);
  await page.screenshot({
    path: "test-results/kitty-clean-menu.png",
    animations: "disabled",
  });
  await menu.getByRole("button", { name: "Ask AI", exact: true }).click();
  const card = page.getByRole("region", { name: "Kitty answer" });
  await expect(card).toHaveAttribute("aria-busy", "false");
  await expect(card.getByRole("textbox", { name: "Ask Kitty" })).toBeFocused();
  expect(calls.some((c) => /generate|web-search/.test(c.method))).toBe(false);
  await expect(
    card.getByRole("button", { name: "Web search", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "test-results/kitty-clean-draft.png",
    animations: "disabled",
  });
});

test("organized local chat supports actions, translation, follow-up and save", async ({
  page,
}) => {
  const calls = await fixtures(page);
  await selectNote(page);
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  const card = page.getByRole("region", { name: "Kitty answer" });
  await expect(card).toContainText(
    "Diplomacy helps countries resolve disagreements.",
  );
  await chooseAction(page, "Summarize");
  await expect(card).toContainText("Countries cooperate.");
  await chooseAction(page, "Translate");
  await expect(card).toContainText("Translated passage.");
  await card.getByLabel("Translation language").selectOption("en");
  await expect(card).toHaveAttribute("aria-busy", "false");
  expect(
    calls.filter((c) => c.method === "generate").at(-1)?.body.system,
  ).toContain("English");
  await card
    .getByRole("textbox", { name: "Ask Kitty" })
    .fill("Why is it useful?");
  await card.getByRole("button", { name: "Send question" }).click();
  await expect(card).toHaveAttribute("aria-busy", "false");
  expect(
    JSON.parse(calls.filter((c) => c.method === "generate").at(-1)!.body.prompt)
      .previousAnswer,
  ).toBe("Translated passage.");
  await card.getByRole("button", { name: "Save as note" }).click();
  await expect(card).toContainText("Saved as a new note");
  await expect(card).toHaveCSS("transform", "none");
  await page.screenshot({
    path: "test-results/kitty-clean-chat-dark.png",
    animations: "disabled",
  });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.screenshot({
    path: "test-results/kitty-clean-chat-light.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 740 });
  const box = await card.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/kitty-clean-chat-narrow.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
});

test("local web search retrieves sources before inference and keeps cloud unused", async ({
  page,
}) => {
  const calls = await fixtures(page);
  await selectNote(page);
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const card = page.getByRole("region", { name: "Kitty answer" });
  await card.getByRole("button", { name: "Web search", exact: true }).click();
  await card
    .getByRole("textbox", { name: "Ask Kitty" })
    .fill("How does it help?");
  await card.getByRole("button", { name: "Send question" }).click();
  await expect(
    card.getByRole("link", { name: "[1]", exact: true }),
  ).toHaveAttribute("href", "https://example.com/diplomacy");
  await card.locator(".kitty-sources summary").click();
  await expect(
    card.getByRole("link", { name: "Diplomacy source", exact: true }),
  ).toBeVisible();
  expect(calls.findIndex((c) => c.method === "web-search")).toBeLessThan(
    calls.findIndex((c) => c.method === "generate"),
  );
  expect(
    JSON.parse(calls.find((c) => c.method === "generate")!.body.prompt)
      .webSources[0].excerpt,
  ).toContain("resolve disagreements");
  expect(calls.some((c) => c.method === "cloud-generate")).toBe(false);
  await page.screenshot({
    path: "test-results/kitty-local-web.png",
    animations: "disabled",
  });
});

test("cloud model picker connects selection to cloud search and translation", async ({
  page,
}) => {
  const calls = await fixtures(page);
  await selectNote(page);
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const card = page.getByRole("region", { name: "Kitty answer" });
  await card
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  await card.getByLabel("AI provider").selectOption("cloud");
  await expect(card.getByLabel("Cloud model").locator("option")).toHaveCount(2);
  await card.getByLabel("Cloud model").selectOption("gpt-4.1");
  await card.getByRole("button", { name: "Close model settings" }).click();
  await card.getByRole("button", { name: "Web search", exact: true }).click();
  await card
    .getByRole("textbox", { name: "Ask Kitty" })
    .fill("What is happening today?");
  await card.getByRole("button", { name: "Send question" }).click();
  await expect(
    card.getByRole("link", { name: "[1]", exact: true }),
  ).toBeVisible();
  expect(calls.find((c) => c.method === "cloud-generate")!.body).toMatchObject({
    model: "gpt-4.1",
    webSearch: true,
  });
  expect(calls.some((c) => c.method === "generate")).toBe(false);
  await chooseAction(page, "Translate");
  await expect(card).toContainText("Translated passage.");
  expect(
    calls.filter((c) => c.method === "cloud-generate").at(-1)!.body.webSearch,
  ).toBe(false);
});

test("cloud setup preserves a failed key entry and never persists it in browser storage", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("**/api/kitty/cloud-status", (route) =>
    route.fulfill({
      body:
        JSON.stringify({ result: { configured: false, models: [] } }) + "\n",
    }),
  );
  let attempts = 0;
  await page.route("**/api/kitty/cloud-connect", (route) =>
    route.fulfill({
      body:
        JSON.stringify(
          ++attempts === 1
            ? {
                error:
                  "The OpenAI API key was not accepted. Reconnect Cloud AI.",
              }
            : { result: { configured: true, models: ["gpt-4.1-mini"] } },
        ) + "\n",
    }),
  );
  await selectNote(page);
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  await page.getByLabel("AI provider").selectOption("cloud");
  const key = page.getByLabel("OpenAI API key");
  await key.fill("fixture-only-key");
  await page.getByRole("button", { name: "Connect Cloud AI" }).click();
  await expect(key).toHaveValue("fixture-only-key");
  await expect(page.getByRole("alert")).toContainText("not accepted");
  await page.getByRole("button", { name: "Connect Cloud AI" }).click();
  await expect(
    page.getByText("Connected for this session", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Cloud model")).toHaveValue("gpt-4.1-mini");
  expect(
    await page.evaluate(
      () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
    ),
  ).not.toContain("fixture-only-key");
});

test("native string errors preserve the actual cloud diagnosis", async ({
  page,
}) => {
  await page.goto("/");
  const message = await page.evaluate(async () => {
    const path = "/src/kitty/managedBridge.ts";
    const { kittyRequest } = await import(path);
    const root = window as any;
    const previous = root.__TAURI_INTERNALS__;
    root.isTauri = true;
    root.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: () =>
        Promise.reject(
          "Connect Cloud AI with your OpenAI API key, or choose Local.",
        ),
    };
    try {
      await kittyRequest("cloud-generate");
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : "wrong error type";
    } finally {
      root.isTauri = false;
      root.__TAURI_INTERNALS__ = previous;
    }
  });
  expect(message).toBe(
    "Connect Cloud AI with your OpenAI API key, or choose Local.",
  );
});

async function fixtures(page: Page) {
  const calls: { method: string; body: any }[] = [];
  await page.route("**/api/kitty/**", async (route) => {
    const method = route.request().url().split("/").pop()!;
    const body = route.request().postDataJSON();
    calls.push({ method, body });
    let result: any = {};
    if (method === "status")
      result = {
        installed: {
          id: "kitty-balanced",
          displayName: "Kitty Balanced",
          backend: "cpu",
          sizeBytes: 1000000,
        },
        models: [],
        partials: [],
      };
    if (method === "cloud-status" || method === "cloud-connect")
      result = { configured: true, models: ["gpt-5-mini", "gpt-4.1"] };
    if (method === "web-search")
      result = {
        provider: "DuckDuckGo",
        sources: [
          {
            title: "Diplomacy source",
            url: "https://example.com/diplomacy",
            excerpt: "Diplomacy helps resolve disagreements.",
          },
        ],
      };
    if (method === "generate" || method === "cloud-generate") {
      const text =
        body.system.includes("Translate") || body.system.includes("translator")
          ? "Translated passage."
          : body.system.includes("Summarize")
            ? "1. Countries cooperate.\n2. Diplomacy resolves disputes."
            : "Diplomacy helps countries resolve disagreements. [1]";
      await new Promise((resolve) => setTimeout(resolve, 120));
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          JSON.stringify({
            event: { phase: "generating", text: text.slice(0, 20) },
          }) +
          "\n" +
          JSON.stringify({
            result: {
              text,
              citations:
                method === "cloud-generate" && body.webSearch
                  ? [
                      {
                        url: "https://example.com/diplomacy",
                        title: "Diplomacy source",
                        start: text.length - 3,
                        end: text.length,
                      },
                    ]
                  : [],
            },
          }) +
          "\n",
      });
    }
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ result }) + "\n",
    });
  });
  return calls;
}
async function selectNote(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByTestId("toolbar-text").locator("..").click();
  await page.mouse.click(430, 330);
  const input = page.locator("textarea.excalidraw-wysiwyg");
  await input.fill("Diplomacy helps countries cooperate.");
  await input.selectText();
  await input.dispatchEvent("keyup", { key: "Shift" });
  await expect(
    page.getByRole("region", { name: "Selection menu" }),
  ).toBeVisible();
}
test("Read embeds the AI answer in the existing page cat card", async ({
  page,
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() =>
    Object.defineProperty(window, "showDirectoryPicker", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  const pdf = await PDFDocument.create();
  pdf
    .addPage([500, 700])
    .drawText("States use diplomacy.", { x: 50, y: 600, size: 16 });
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page
    .locator(".reader-header-actions")
    .getByRole("button", { name: "Import PDF" })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "Kitty-AI.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByTestId(/pdf-card-/).click();
  const span = page
    .locator(".pdf-text-layer span")
    .filter({ hasText: "States use diplomacy" })
    .first();
  await expect(span).toBeAttached();
  await span.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 500,
        clientY: 230,
      }),
    );
  });
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  const card = page
    .locator("[data-kitty-reader-host]")
    .getByRole("region", { name: "Kitty answer" });
  await expect(card).toContainText("Diplomacy helps countries");
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Insert into note" }),
  ).toHaveCount(0);
  await card.getByRole("button", { name: "Web search", exact: true }).click();
  await card
    .getByRole("textbox", { name: "Ask Kitty" })
    .fill("How does diplomacy help?");
  await card.getByRole("button", { name: "Send question" }).click();
  await expect(
    card.getByRole("link", { name: "[1]", exact: true }),
  ).toHaveAttribute("href", "https://example.com/diplomacy");
  await expect(card).toHaveCSS("transform", "none");
  await page.screenshot({
    path: "test-results/kitty-ai-reader.png",
    animations: "disabled",
  });
  await card.getByRole("button", { name: "Close Kitty", exact: true }).click();
  await expect(card).toHaveCount(0);
});
