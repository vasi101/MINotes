import { test, expect, type Page } from "@playwright/test";
async function capture(page: Page, path: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("main")).toHaveCSS("opacity", "1");
  await page.screenshot({ path });
}
test("notes, tasks and editor survive reload; trash restores notes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Notes", exact: true }),
  ).toBeVisible();
  await capture(page, "artifacts/notes.png");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Code of Conduct" }),
  ).toBeVisible();
  await capture(page, "artifacts/tasks.png");
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Task title").fill("Ship desktop UI");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Complete Ship desktop UI" }).click();
  await expect(
    page.getByRole("button", { name: "Complete Ship desktop UI" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Complete Ship desktop UI" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page.getByLabel("Note title")).toBeVisible();
  await capture(page, "artifacts/editor.png");
  await page.getByLabel("Note title").fill("A persistent note");
  await page.getByLabel("Note content").fill("Hello from Mi Notes");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByLabel("Note content").press("End");
  await page.getByLabel("Note content").pressSequentially(" bold");
  await expect(page.locator(".tiptap strong")).toContainText("bold");
  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.reload();
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByRole("button", { name: /A persistent note/ }).click();
  await expect(page.getByLabel("Note content")).toContainText(
    "Hello from Mi Notes",
  );
  await page.getByRole("button", { name: "Note options" }).click();
  await page.getByRole("button", { name: "Move to recently deleted" }).click();
  await expect(
    page.getByRole("button", { name: /A persistent note/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Recently deleted", exact: true })
    .click();
  await page.getByRole("button", { name: /A persistent note/ }).click();
  await page.getByRole("button", { name: "Note options" }).click();
  await page.getByRole("button", { name: "Restore note" }).click();
  expect(errors).toEqual([]);
});
test("drawing tools, history, colors, save and reopen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("Note title").fill("Sketch");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.getByRole("button", { name: "Marker", exact: true }).click();
  await expect(page.locator(".drawing-screen")).toHaveJSProperty(
    "scrollTop",
    0,
  );
  await expect(
    page.getByRole("button", { name: "Save drawing" }),
  ).toBeInViewport();
  await page.mouse.move(100, 180);
  await page.mouse.down();
  await page.mouse.move(250, 310, { steps: 15 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Undo drawing" }),
  ).toBeEnabled();
  await capture(page, "artifacts/drawing.png");
  await page.getByRole("button", { name: "Undo drawing" }).click();
  await expect(
    page.getByRole("button", { name: "Redo drawing" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Redo drawing" }).click();
  await page.getByRole("button", { name: "Open colors" }).click();
  await capture(page, "artifacts/palette.png");
  await page
    .getByRole("button", { name: "Color #ff4c55", exact: true })
    .click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Save drawing" }).click();
  await expect(page.getByRole("img", { name: "Saved drawing" })).toBeVisible();
  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.reload();
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByRole("button", { name: /Sketch/ }).click();
  await page.getByRole("button", { name: "Edit drawing" }).click();
  await expect(
    page.getByRole("button", { name: "Save drawing" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("drawing image transform and eraser edits are saved", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("Note title").fill("Image test");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page
    .locator(".drawing-screen input[type=file]")
    .setInputFiles("src-tauri/icons/128x128.png");
  await expect(
    page.getByRole("button", { name: "Delete selected image" }),
  ).toBeVisible();
  await page.mouse.move(110, 170);
  await page.mouse.down();
  await page.mouse.move(230, 220, { steps: 10 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Pencil", exact: true }).click();
  await page.mouse.move(90, 400);
  await page.mouse.down();
  await page.mouse.move(250, 400, { steps: 10 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  // Konva updates its hit-test canvas on the next animation frame.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.mouse.click(170, 400);
  await page.getByRole("button", { name: "Save drawing" }).click();
  const drawing = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("minotes-v1")!).state.notes.find(
        (n: { title: string }) => n.title === "Image test",
      ).drawing,
  );
  expect(drawing.images).toHaveLength(1);
  expect(drawing.images[0].x).toBeGreaterThan(100);
  expect(drawing.strokes).toHaveLength(0);
  expect(errors).toEqual([]);
});
test("desktop fills the window and light mode works", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator("main")).toHaveCSS("width", "1440px");
  await expect(page.locator("main")).toHaveCSS("height", "1000px");
  await capture(page, "artifacts/desktop.png");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("light");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page.locator(".editor-screen")).toHaveCSS("width", "1440px");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.locator(".drawing-screen")).toHaveCSS("width", "1440px");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator(".drawing-screen")).toHaveCSS("width", "1920px");
  await expect(page.locator(".drawing-screen canvas").first()).toHaveAttribute(
    "width",
    "1920",
  );
});
