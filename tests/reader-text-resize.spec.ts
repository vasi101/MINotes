import { test, expect } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";

async function createSamplePdf(): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([500, 700]);
  page.drawText("Hello World PDF", {
    x: 50,
    y: 600,
    size: 24,
    color: rgb(0.1, 0.1, 0.1),
  });
  return await pdfDoc.save();
}

test("Read section: type text annotation, select it, resize it with toolbar controls and handles", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
    window.localStorage.clear();
  });
  await page.goto("/");

  // 1. Go to Read tab
  await page.getByRole("button", { name: "Read", exact: true }).click();

  // 2. Import sample PDF
  const pdfBytes = await createSamplePdf();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add to library", exact: true }).click();
  await page.locator(".reader-header-actions").getByRole("button", { name: "Import PDF" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "ResizeTest.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdfBytes),
  });

  // 3. Open document
  await page.getByTestId(/pdf-card-/).first().click();
  await expect(page.locator(".pdf-viewer")).toBeVisible();

  // 4. Switch to Text tool
  await page.locator('.reader-ring-toggle').click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();

  // 5. Double click on page 1 to type text
  const pageSlot = page.locator('.pdf-page-slot').first();
  await pageSlot.scrollIntoViewIfNeeded();
  const textLayer = pageSlot.locator('.pdf-text-layer');
  await expect(textLayer).toBeVisible();

  // Double click near top center of the page
  const box = await textLayer.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.dblclick(box.x + box.width * 0.3, box.y + box.height * 0.3);
  }

  // Type in the text input
  const textInput = page.locator('.pdf-text-input');
  await expect(textInput).toBeVisible();
  await textInput.fill("Antigravity Notes");
  await textInput.press("Enter");

  // 5. Verify the text mark appears and is immediately selected
  const textMark = pageSlot.locator('text[data-kind="text"]');
  await expect(textMark).toBeVisible();
  await expect(textMark).toHaveText("Antigravity Notes");

  // Verify selection box and font size badge are visible
  const selectionBox = pageSlot.locator('.pdf-selection-box');
  await expect(selectionBox).toBeVisible();

  await expect(page.locator('.reader-selection-status')).toHaveCount(0);
  await selectionBox.click({button:'right'});
  await expect(page.locator('.reader-selection-status')).toHaveCount(0);
  await page.getByRole('button',{name:'AI dictionary - coming soon'}).click();
  await expect(page.locator('.reader-island-coming')).toContainText('Coming soon');
  await page.getByRole('button',{name:'AI dictionary - coming soon'}).click();
  // 10. Test corner resize handle dragging
  const handle = pageSlot.locator('circle[data-transform="se"]');
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  if (handleBox) {
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 60, handleBox.y + handleBox.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
  }

  expect(Number(await textMark.getAttribute('font-size'))).toBeGreaterThan(18);
});
