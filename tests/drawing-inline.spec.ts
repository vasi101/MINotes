import { test, expect } from "@playwright/test";

test("save drawing continues on next line and preserves text when edited again", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("Note title").fill("Drawing with next line");
  const content = page.getByLabel("Note content");
  await content.fill("Before drawing");
  await content.press("End");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.mouse.move(100, 200);
  await page.mouse.down();
  await page.mouse.move(220, 250, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save drawing" }).click();
  await expect(content).toBeFocused();
  await page.keyboard.type("After drawing");
  await expect(content.locator(".node-drawing + p")).toHaveText(
    "After drawing",
  );
  await expect(content.locator("p").first()).toHaveText("Before drawing");
  await content.press("Enter");
  await page.keyboard.type("Another line");
  await page.getByRole("button", { name: "Edit drawing" }).dblclick();
  await page.getByRole("button", { name: "Save drawing" }).click();
  await expect(content.locator(".drawing-block")).toHaveCount(1);
  await expect(content.locator(".node-drawing + p")).toHaveText(
    "After drawing",
  );
  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.reload();
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByRole("button", { name: /Drawing with next line/ }).click();
  await expect(content.locator(".drawing-block")).toHaveCount(1);
  await expect(content.locator(".node-drawing + p")).toHaveText(
    "After drawing",
  );
  await expect(content).toContainText("Another line");
  expect(errors).toEqual([]);
});

test("older drawings gain an editable next line without duplication", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const data = JSON.parse(
      localStorage.getItem("minotes-v1") || '{"state":{}}',
    );
    data.state.notes = [
      {
        id: "legacy-drawing",
        title: "Older drawing",
        html: "<p>Existing text</p>",
        preview: "Existing text",
        folder: "",
        date: new Date().toISOString(),
        drawing: { strokes: [], images: [] },
        drawingPreview:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      },
    ];
    localStorage.setItem("minotes-v1", JSON.stringify(data));
  });
  await page.reload();
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByRole("button", { name: /Older drawing/ }).click();
  const content = page.getByLabel("Note content");
  await expect(content.locator(".node-drawing + p")).toBeVisible();
  await content.locator(".node-drawing + p").click();
  await page.keyboard.type("Now I can continue");
  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.getByRole("button", { name: /Older drawing/ }).click();
  await expect(content.locator(".drawing-block")).toHaveCount(1);
  await expect(content.locator(".node-drawing + p")).toHaveText(
    "Now I can continue",
  );
});

test("drawing notes support repeated independent drawings", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("Note title").fill("Many drawing pages");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.getByLabel("Page width").fill("1200");
  await page.getByRole("button", { name: "Save drawing" }).click();
  await expect(page.locator(".drawing-block")).toHaveCount(1);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.getByLabel("Page height").fill("700");
  await page.getByRole("button", { name: "Save drawing" }).click();
  await expect(page.locator(".drawing-block")).toHaveCount(2);

  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("minotes-v1")!).state);
  expect(state.notes[0].drawings).toHaveLength(2);
  expect(state.notes[0].drawings[0].width).toBe(1200);
  expect(state.notes[0].drawings[1].height).toBe(700);
});
