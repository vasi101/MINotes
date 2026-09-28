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

test("selection menu never generates; explicit AI answers insert and save", async ({
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
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({
        result: { text: "The management of relations between countries." },
      }),
    });
  });
  const input = await openText(page);
  await input.dispatchEvent("keyup", { key: "Shift" });
  await expect(
    page.getByRole("region", { name: "Selection menu" }),
  ).toBeVisible();
  expect(dictionary).toBe(0);
  expect(ai).toBe(0);
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  const island = page.getByRole("region", { name: "Kitty answer" });
  await expect(island).toContainText(
    "The management of relations between countries.",
  );
  expect(dictionary).toBe(0);
  expect(ai).toBe(1);
  await island.getByLabel("More answer options").click();
  await island.getByRole("button", { name: "Insert into note" }).click();
  await expect(island).toContainText("Inserted into your note");
  await expect
    .poll(() => savedText(page))
    .toContain("The management of relations between countries.");
  await island.getByRole("button", { name: "Save as note" }).click();
  await expect(island).toContainText("Saved as a new note");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("minotes-v1")!).state.notes.length,
      ),
    )
    .toBe(2);
});

test("dictionary miss never calls AI; explicit translation can replace selected text", async ({
  page,
}) => {
  await configure(page);
  const requests: any[] = [];
  await page.route("https://freedictionaryapi.com/**", (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.route("**/api/kitty/generate", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ result: { text: "Translated text." } }),
    });
  });
  let input = await openText(page, "xyzabc");
  await input.click({ button: "right" });
  await page.getByRole("button", { name: "Meaning", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Dictionary meaning" }),
  ).toContainText("No definition found");
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Close dictionary" }).click();
  input = page.locator("textarea.excalidraw-wysiwyg");
  if (!(await input.count())) await page.mouse.dblclick(450, 340);
  await input.selectText();
  await input.click({ button: "right" });
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  const island = page.getByRole("region", { name: "Kitty answer" });
  await expect(island).toContainText("Translated text.");
  expect(requests).toHaveLength(1);
  await island.getByLabel("More answer options").click();
  await island.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(island).toContainText("Replaced selected text");
  await expect.poll(() => savedText(page)).toContain("Translated text.");
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

test("unavailable AI shows retry and navigating away cancels the island", async ({
  page,
}) => {
  await configure(page);
  await page.route("**/api/kitty/generate", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ error: "Kitty is unavailable. Try again." }),
    }),
  );
  const input = await openText(page);
  await input.click({ button: "right" });
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Kitty is unavailable");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page
    .getByRole("button", { name: "Back to notes", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Kitty answer" })).toHaveCount(
    0,
  );
});

test("custom question uses captured note text and popup fits a narrow viewport", async ({
  page,
}) => {
  await configure(page);
  const requests: any[] = [];
  await page.route("https://freedictionaryapi.com/**", () => {
    throw new Error("Questions must bypass the dictionary");
  });
  await page.route("**/api/kitty/generate", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({
        result: {
          text: "Diplomacy helps countries resolve disagreements peacefully.",
        },
      }),
    });
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
  await popup.getByRole("button", { name: "Ask AI", exact: true }).click();
  const question = page.getByRole("textbox", {
    name: "Ask Kitty",
    exact: true,
  });
  await question.fill("Why is it important?");
  await expect(question).toHaveValue("Why is it important?");
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(
    page.getByRole("region", { name: "Kitty answer" }),
  ).toContainText("resolve disagreements peacefully");
  expect(JSON.parse(requests[0].prompt)).toMatchObject({
    selectedText: "diplomacy",
    question: "Why is it important?",
  });
  const box = await page.locator(".kitty-island").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(page.locator(".kitty-island")).toHaveCSS("transform", "none");
  await expect(page.locator(".kitty-island")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "test-results/kitty-narrow.png" });
});
