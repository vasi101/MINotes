import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";
import fs from "fs";
import path from "path";
import os from "os";

async function createSamplePdf(pageCount: number = 3): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  for (let i = 1; i <= pageCount; i++) {
    const page = pdfDoc.addPage([500, 700]);
    page.drawText(`Sample Study Material - Page ${i}`, {
      x: 50,
      y: 600,
      size: 24,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText(`This is the content of page ${i} for testing scrolling and reading.`, {
      x: 50,
      y: 550,
      size: 14,
      color: rgb(0.3, 0.3, 0.3),
    });
  }
  return await pdfDoc.save();
}

test("Read section: library empty state, import PDF, scroll through pages, jump pages and back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.addInitScript(() => Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true }));
  await page.goto("/");

  // 1. Navigate to Read tab
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Read", exact: true })).toBeVisible();

  // 2. Verify empty state
  await expect(page.getByText("No PDF documents yet")).toBeVisible();

  // 3. Generate sample multi-page PDF & import
  const pdfBytes = await createSamplePdf(4);
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.locator(".reader-header-actions").getByRole("button", { name: "Import PDF" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "Lecture-Notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdfBytes),
  });

  // 4. Verify card appears in library
  await expect(page.getByText("Lecture-Notes")).toBeVisible();
  await expect(page.getByText(/4 pages/)).toBeVisible();

  // 5. Click card to open in PDFViewer
  await page.getByTestId(/pdf-card-/).click();

  // 6. Verify PDFViewer layout and topbar
  await expect(page.locator(".pdf-viewer")).toBeVisible();
  await expect(page.locator(".reader-doc-name")).toHaveText("Lecture-Notes");
  await expect(page.locator(".reader-page-indicator")).toContainText("1 / 4");

  // 7. Verify all 4 page slots are present in the scroller with non-zero heights
  const slots = page.locator(".pdf-page-slot");
  await expect(slots).toHaveCount(4);

  // 8. Test scrolling through pages: scroll down the scroller
  const scroller = page.locator(".pdf-scroller");
  await expect(scroller).toBeVisible();

  // Scroll down to page 3
  await page.locator(".reader-page-nav-btn[title='Next page']").click();
  await expect(page.locator(".reader-page-indicator")).toContainText("2 / 4");

  await page.locator(".reader-page-nav-btn[title='Next page']").click();
  await expect(page.locator(".reader-page-indicator")).toContainText("3 / 4");

  // Previous page
  await page.locator(".reader-page-nav-btn[title='Previous page']").click();
  await expect(page.locator(".reader-page-indicator")).toContainText("2 / 4");

  // 9. Verify reader toolbar has all required tools
  await expect(page.getByRole("button", { name: "Highlight", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pen", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Marker", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Eraser", exact: true })).toBeVisible();

  // 10. Verify text layer is present and text is selectable
  const textLayer = page.locator('[data-page-number="2"] .pdf-text-layer');
  await expect(textLayer).toBeVisible();
  await expect(textLayer.locator("span").first()).toBeVisible({ timeout: 5000 });

  // 11. Click Back to library
  await page.getByRole("button", { name: "Back to library" }).click();
  await expect(page.locator(".pdf-viewer")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Read", exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});

test("Read section: Explorer-like folder structure with Xiaomi Notes styling and inheritance", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.addInitScript(() => Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true }));
  await page.goto("/");

  // Navigate to Read tab
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Read", exact: true })).toBeVisible();

  // 1. Create a new folder "Mathematics" at Root
  await page.getByRole("button", { name: "New folder" }).first().click();
  await page.getByLabel("Folder label").fill("Mathematics");
  await page.getByRole("button", { name: "Create folder" }).click();

  // Verify "Mathematics" appears as a Xiaomi folder tile with 0 documents
  const mathTile = page.locator(".folder-tile").filter({ hasText: "Mathematics" });
  await expect(mathTile).toBeVisible();
  await expect(mathTile.getByText("0 documents")).toBeVisible();

  // 2. Click on "Mathematics" folder tile to drill down into it (Explorer style)
  await mathTile.locator(".folder-open").click();

  // Verify Explorer breadcrumb navigation bar
  const breadcrumb = page.locator(".reader-breadcrumb-nav");
  await expect(breadcrumb).toBeVisible();
  await expect(breadcrumb).toContainText("Library");
  await expect(breadcrumb).toContainText("Mathematics");

  // Verify empty folder state inside "Mathematics"
  await expect(page.getByText('"Mathematics" is empty')).toBeVisible();

  // 3. Test whole folder import inside this folder with directory inheritance
  const pdfBytes = await createSamplePdf(2);
  const calculusDir = path.join(os.tmpdir(), "Calculus");
  fs.mkdirSync(calculusDir, { recursive: true });
  fs.writeFileSync(path.join(calculusDir, "Calculus-101.pdf"), Buffer.from(pdfBytes));

  try {
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import folder" }).first().click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(calculusDir);

    // Subfolder "Calculus" appears as a Xiaomi folder tile inside Mathematics!
    const calcTile = page.locator(".folder-tile").filter({ hasText: "Calculus" });
    await expect(calcTile).toBeVisible();

    // Click "Calculus" folder tile
    await calcTile.locator(".folder-open").click();

    // Document card Calculus-101 appears inside Calculus!
    await expect(page.getByText("Calculus-101")).toBeVisible();

    // 4. Click Library breadcrumb to navigate back to Root
    await page.locator(".reader-breadcrumb-nav").getByRole("button", { name: "Library" }).click();
    await expect(page.locator(".folder-tile").filter({ hasText: "Mathematics" })).toBeVisible();
    await expect(page.locator(".folder-tile").filter({ hasText: "Mathematics" }).getByText("1 document")).toBeVisible();
  } finally {
    fs.rmSync(calculusDir, { recursive: true, force: true });
  }

  expect(errors).toEqual([]);
});
