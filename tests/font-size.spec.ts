import { test, expect } from "@playwright/test";

test("font size formats selected text, persists, and does not scale the page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("Note title").fill("Font size test");
  const content = page.getByLabel("Note content");
  await content.fill("Small large");
  await content.press("End");
  await content.press("Control+Shift+ArrowLeft");
  const before = await page.locator(".editor-toolbar").boundingBox();
  const scale = await page.evaluate(() => window.visualViewport?.scale);
  await page.getByRole("button", { name: "Increase text size" }).click();
  const sized = content.locator('span[style*="font-size"]');
  await expect(sized).toHaveText("large");
  await expect(sized).toHaveCSS("font-size", "19px");
  await expect(content.locator("p")).toHaveCSS("font-size", "17px");
  await page.getByRole("button", { name: "Increase text size" }).click();
  await expect(sized).toHaveCSS("font-size", "21px");
  await page.getByRole("button", { name: "Decrease text size" }).click();
  await expect(sized).toHaveCSS("font-size", "19px");
  expect(await page.locator(".editor-toolbar").boundingBox()).toEqual(before);
  expect(await page.evaluate(() => window.visualViewport?.scale)).toEqual(
    scale,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(sized).toHaveCSS("font-size", "21px");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(sized).toHaveCSS("font-size", "19px");
  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.reload();
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByRole("button", { name: /Font size test/ }).click();
  await expect(sized).toHaveCSS("font-size", "19px");
});

test("font size at the caret affects new typing only", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New note" }).click();
  const content = page.getByLabel("Note content");
  await content.fill("Original");
  await content.press("End");
  await page.getByRole("button", { name: "Increase text size" }).click();
  await page.keyboard.type(" bigger");
  await expect(content.locator("span")).toHaveText(" bigger");
  await expect(content.locator("span")).toHaveCSS("font-size", "19px");
  await expect(content.locator("p")).toHaveCSS("font-size", "17px");
});
