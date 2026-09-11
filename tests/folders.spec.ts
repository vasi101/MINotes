import { test, expect } from "@playwright/test";

test("opening folders can be recolored and renamed without losing notes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Your folders" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open folder ANSWER IDEAS", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("main")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "artifacts/folder-home.png" });
  await page
    .getByRole("button", { name: "Customize ANSWER IDEAS", exact: true })
    .click();
  await page.getByLabel("Folder label", { exact: true }).fill("My ideas");
  await page
    .getByRole("button", { name: "Folder color #df8ab7", exact: true })
    .click();
  await page.getByRole("button", { name: "Save folder", exact: true }).click();
  await page.reload();
  const folder = page.getByRole("button", {
    name: "Open folder My ideas",
    exact: true,
  });
  await expect(folder.locator("svg rect").first()).toHaveAttribute(
    "fill",
    "#df8ab7",
  );
  await folder.click();
  await expect(
    page.getByRole("button", { name: /This is not good as hell/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("Note title").fill("Inside my folder");
  await page.getByRole("button", { name: "Back to notes" }).click();
  await expect(
    page.getByRole("button", { name: /Inside my folder/ }),
  ).toBeVisible();
  const assigned = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("minotes-v1")!).state.notes.find(
        (n: { title: string }) => n.title === "Inside my folder",
      ).folder,
  );
  expect(assigned).toBe("My ideas");
  expect(errors).toEqual([]);
});

test("create folder with custom color and reject duplicate labels", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("Folder label", { exact: true }).fill("Travel");
  await page.getByLabel("Custom folder color").fill("#123abc");
  await page.getByRole("button", { name: "Save folder", exact: true }).click();
  await page
    .getByRole("button", { name: "Customize Travel", exact: true })
    .click();
  await page.getByLabel("Folder label", { exact: true }).fill("Excerpts");
  await page.getByRole("button", { name: "Save folder", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Choose a different folder name.",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(
    page
      .getByRole("button", { name: "Open folder Travel", exact: true })
      .locator("svg rect")
      .first(),
  ).toHaveAttribute("fill", "#123abc");
  await page
    .getByRole("button", { name: "Open folder Travel", exact: true })
    .click();
  await expect(page.getByText("No notes here yet")).toBeVisible();
  await page.getByRole("button", { name: "Back to folders" }).click();
  await expect(page.locator(".folder-grid")).toHaveCSS(
    "grid-template-columns",
    /\d+px \d+px$/,
  );
  await page.screenshot({ path: "artifacts/folder-home-compact.png" });
});
