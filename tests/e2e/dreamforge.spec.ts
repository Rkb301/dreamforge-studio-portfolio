import { expect, test, type Page } from "@playwright/test";
import { relationshipState } from "../fixtures/states.ts";

const watchErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
};
const createCharacter = async (page: Page, name: string): Promise<void> => {
  await page.getByRole("button", { name: "Create Character" }).click();
  await page.locator('#modal-container input[type="text"]').first().fill(name);
  await page
    .locator("#modal-container")
    .getByRole("button", { name: "Create", exact: true })
    .click();
};

test("clean boot has no uncaught console errors", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Universes" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("P0 relationship-bearing legacy state survives repeated reload and keeps analytics", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.addInitScript(
    (state) => localStorage.setItem("dreamforge_data", JSON.stringify(state)),
    relationshipState,
  );
  await page.goto("/#relationships");
  await expect(
    page.getByRole("heading", { name: "Relationship Intelligence" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Secret Connection: Bram (Distrust, Very High)",
    }),
  ).toBeVisible();
  await page.reload();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Relationship Intelligence" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Secret Connection: Bram (Distrust, Very High)",
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("core CRUD, relationship, graph, audit, chat, search, export and import journey", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Create Universe" }).click();
  await page
    .locator('#modal-container input[type="text"]')
    .fill("Journey World");
  await page
    .locator("#modal-container")
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await page.getByRole("button", { name: "Open" }).click();
  await createCharacter(page, "Aster");
  await createCharacter(page, "Bram");
  await page.getByRole("link", { name: "Relationships" }).click();
  await page.getByRole("button", { name: "Add Relationship" }).click();
  const selects = page.locator("#modal-container select");
  await selects.nth(0).selectOption({ label: "Aster (Character)" });
  await selects.nth(1).selectOption({ label: "Bram (Character)" });
  await page
    .locator("#modal-container")
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await expect(page.getByText("Aster + Bram")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Aster + Bram")).toBeVisible();
  await page.getByRole("link", { name: "Graph" }).click();
  await expect(
    page.getByRole("heading", { name: "Universe Explorer" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Search" }).click();
  await expect(page.getByPlaceholder("Search by keyword or tag")).toBeVisible();
  await page.getByRole("link", { name: "Continuity Audit" }).click();
  await expect(
    page.getByRole("columnheader", { name: "Severity" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Universe Chat" }).click();
  await expect(
    page.getByPlaceholder(
      "Ask about conflicts, leaders, missing lore, or what to build next...",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Data" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: "dreamforge_data.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(relationshipState)),
  });
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.reload();
  expect(errors).toEqual([]);
});

test("World Seeder preview validates and saves approved generated content", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Create Universe" }).click();
  await page.locator("#modal-container input").fill("Seeder World");
  await page
    .locator("#modal-container")
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("link", { name: "AI Architect" }).click();
  await page
    .getByPlaceholder(
      "Create a Type I civilization with 5 countries and 3 cities per country",
    )
    .fill("Create a small coastal town with five characters and no war");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Generated Worldbuilding Package" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Save Approved" }).click();
  await expect(
    page.getByRole("heading", { name: "AI World Architect" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
