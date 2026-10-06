import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const entry = {
  entries: [
    {
      partOfSpeech: "noun",
      synonyms: ["statecraft", "negotiation"],
      senses: [
        { definition: "The management of relations between countries." },
        { definition: "Skill in handling sensitive matters." },
        { definition: "The practice of negotiation." },
        { definition: "A fourth meaning for progressive disclosure." },
      ],
    },
  ],
};
async function configure(page: Page, auto = false) {
  await page.addInitScript((auto) => {
    localStorage.setItem(
      "minotes-kitty-settings-v1",
      JSON.stringify({
        state: {
          askOnSelection: auto,
          model: "fixture",
          translationModel: "",
          keepWarmMinutes: 10,
          targetLanguage: "ne",
        },
        version: 0,
      }),
    );
  }, auto);
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function openText(page: Page, text = "diplomacy") {
  await page.goto("/");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(page.locator(".excalidraw")).toBeVisible();
  await page.getByTestId("toolbar-text").locator("..").click();
  await page.mouse.click(430, 330);
  const input = page.locator("textarea.excalidraw-wysiwyg");
  await input.fill(text);
  await input.selectText();
  return input;
}
async function savedText(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/canvas/storage.ts";
    const { loadScene } = await import(path);
    const note = JSON.parse(localStorage.getItem("minotes-v1")!).state.notes[0];
    const scene = await loadScene(note.id);
    return scene?.elements
      .filter(
        (e: { type: string; isDeleted: boolean }) =>
          e.type === "text" && !e.isDeleted,
      )
      .map((e: { text: string }) => e.text)
      .join("\n");
  });
}

test("note selection offers dictionary only and ignores AI chat", async ({
  page,
}) => {
  await configure(page, true);
  let dictionary = 0,
    ai = 0;
  await page.route("https://freedictionaryapi.com/**", (route) => {
    dictionary++;
    return route.fulfill({ json: entry });
  });
  await page.route("**/api/kitty/generate", (route) => {
    ai++;
    return route.fulfill({ status: 500, body: "AI is unavailable in Notes" });
  });
  const input = await openText(page);
  await input.dispatchEvent("keyup", { key: "Shift" });
  const menu = page.getByRole("region", { name: "Selection menu" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Meaning" })).toBeVisible();
  for (const action of ["Explain", "Summarize", "Simplify", "Translate", "Ask AI"]) {
    await expect(menu.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("minotes:open-kitty-chat", {
        detail: { text: "diplomacy" },
      }),
    ),
  );
  await expect(page.getByRole("region", { name: "Kitty answer" })).toHaveCount(0);
  await menu.getByRole("button", { name: "Meaning", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Dictionary meaning" }),
  ).toContainText("The management of relations between countries.");
  expect(dictionary).toBe(1);
  expect(ai).toBe(0);
});

test("PDF selection offers Kitty and saved cache works with dictionary offline after reload", async ({
  page,
}) => {
  await configure(page);
  let requests = 0;
  await page.route("https://freedictionaryapi.com/**", (route) => {
    requests++;
    return route.fulfill({ json: entry });
  });
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
    .drawText("States use diplomacy to pursue national interests.", {
      x: 50,
      y: 600,
      size: 16,
    });
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
    name: "Kitty-study.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByTestId(/pdf-card-/).click();
  const select = async () => {
    const span = page
      .locator(".pdf-text-layer span")
      .filter({ hasText: "States use diplomacy" })
      .first();
    await expect(span).toBeAttached();
    await span.evaluate((element) => {
      const node = element.firstChild!;
      const start = node.textContent!.indexOf("diplomacy");
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 9);
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
    await page
      .getByRole("button", { name: /^(Meaning|Phrase meaning)$/, exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Dictionary meaning" }),
    ).toContainText("The management of relations between countries.");
  };
  await select();
  expect(requests).toBe(1);
  await page
    .getByRole("button", { name: "Close dictionary", exact: true })
    .click();
  await page.keyboard.press("f");
  await expect(page.locator(".pdf-viewer")).toHaveClass(/reader-fullscreen/);
  await select();
  await expect(page.locator(".dictionary-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".pdf-viewer")).not.toHaveClass(
    /reader-fullscreen/,
  );
  await select();
  await expect(
    page.getByRole("button", { name: "Replace", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Insert ↓", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/kitty-pdf.png" });
  await page.reload();
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.getByTestId(/pdf-card-/).click();
  await page.unroute("https://freedictionaryapi.com/**");
  await page.route("https://freedictionaryapi.com/**", (route) => {
    requests++;
    return route.abort();
  });
  await select();
  expect(requests).toBe(1);
});

test("note keyboard shortcut only exposes dictionary action on narrow screens", async ({
  page,
}) => {
  await configure(page);
  let requests = 0;
  await page.route("**/api/kitty/generate", (route) => {
    requests++;
    return route.fulfill({ status: 500, body: "AI is unavailable in Notes" });
  });
  const input = await openText(page, "diplomacy");
  await input.press("Control+Shift+K");
  const popup = page.getByRole("region", {
    name: "Selection menu",
    exact: true,
  });
  await expect(popup).toBeVisible();
  await page.setViewportSize({ width: 390, height: 740 });
  const popupBox = await popup.boundingBox();
  expect(popupBox!.x).toBeGreaterThanOrEqual(0);
  expect(popupBox!.x + popupBox!.width).toBeLessThanOrEqual(390);
  await expect(popup.getByRole("button", { name: "Meaning" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Ask AI" })).toHaveCount(0);
  await expect(popup.getByRole("button", { name: "Explain" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Kitty answer" })).toHaveCount(0);
  expect(requests).toBe(0);
});
