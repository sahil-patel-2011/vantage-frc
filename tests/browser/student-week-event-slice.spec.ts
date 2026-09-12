import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Connect TBA", "The Blue Alliance", "TBA/Statbotics", "Setup required", "OAuth", "ONSHAPE_"];

test("student this week can walk Event day packing/checklist → My hours clock-in → Pick desk", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto("/command");
  await expect(page.locator("body")).not.toContainText("Application error");
  await page
    .getByRole("heading", { name: /Loading/i })
    .waitFor({ state: "hidden", timeout: 12_000 })
    .catch(() => undefined);
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Event day still shows ${phrase}`).not.toContainText(phrase);
  }
  const related = page.getByRole("navigation", { name: /Related/i }).first();
  if (await related.count()) {
    await expect(related.getByRole("link", { name: "Packing" })).toBeVisible();
    await expect(related.getByRole("link", { name: "Match checklist" })).toBeVisible();
    await expect(related.getByRole("link", { name: "Tool checkout" })).toBeVisible();
    await expect(related.getByRole("link", { name: "Inspection" })).toBeVisible();
    await related.getByRole("link", { name: "Packing" }).click();
    await waitForLoadingGone(page);
    await expect(page).toHaveURL(/\/packing/);
    await expect(page.locator("body")).not.toContainText("Application error");
  }

  await page.goto("/packing");
  await expect(page.locator("body")).not.toContainText("Application error");
  await page
    .getByText("Loading packing lists")
    .waitFor({ state: "hidden", timeout: 12_000 })
    .catch(() => undefined);
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Packing still shows ${phrase}`).not.toContainText(phrase);
  }
  const packingPrimary = page
    .getByRole("link", { name: /Choose your team|Create competition load-out|Sign in again/i })
    .or(page.getByRole("button", { name: /Create competition load-out|New list/i }));
  await expect(packingPrimary.first()).toBeVisible({ timeout: 12_000 });

  await page.goto("/match-checklist");
  await expect(page.locator("body")).not.toContainText("Application error");
  await page
    .getByRole("heading", { name: /Loading/i })
    .waitFor({ state: "hidden", timeout: 12_000 })
    .catch(() => undefined);
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Match checklist still shows ${phrase}`).not.toContainText(
      phrase,
    );
  }
  await expect(page.getByRole("heading", { level: 1, name: "Pre-match checklist" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);

  await page.goto("/tool-checkout");
  await expect(page.locator("body")).not.toContainText("Application error");
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Tool checkout still shows ${phrase}`).not.toContainText(
      phrase,
    );
  }

  await page.goto("/inspection-copilot");
  await expect(page.locator("body")).not.toContainText("Application error");
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Inspection still shows ${phrase}`).not.toContainText(phrase);
  }
  await expect(page.getByText("Setup required")).toHaveCount(0);

  await page.goto("/hours-self-view");
  await expect(page.locator("body")).not.toContainText("Application error");
  await page
    .getByRole("heading", { name: /Loading My hours/i })
    .waitFor({ state: "hidden", timeout: 12_000 })
    .catch(() => undefined);
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `My hours still shows ${phrase}`).not.toContainText(phrase);
  }
  await expect(page.getByRole("heading", { name: "My hours" })).toBeVisible();
  const hoursPrimary = page.getByRole("button", { name: /Clock in|Clock out|Retry/i }).or(
    page.getByRole("link", { name: /Choose your team|Sign in again/i }),
  );
  await expect(hoursPrimary.first()).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText("hour_logs")).toHaveCount(0);
  if (await page.getByRole("button", { name: "Clock in" }).count()) {
    await page.getByRole("button", { name: "Clock in" }).click();
    await expect(page.locator("body")).not.toContainText("Application error");
  }

  await page.goto("/strategy?tab=picks");
  await expect(page.locator("body")).not.toContainText("Application error");
  await page
    .getByRole("heading", { name: /Loading pick desk/i })
    .waitFor({ state: "hidden", timeout: 12_000 })
    .catch(() => undefined);
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Pick desk still shows ${phrase}`).not.toContainText(phrase);
  }
  await expect(page.getByText(/\bEPA\b/)).toHaveCount(0);
  const pickHeading = page.getByRole("heading", {
    name: /Pick desk|Rank, pick, and lock|No teams to rank yet|Choose your team/i,
  });
  await expect(pickHeading.first()).toBeVisible({ timeout: 12_000 });
  const pickPrimary = page
    .getByRole("button", { name: /Lock this list|Retry/i })
    .or(page.getByRole("link", { name: /Open Scouting|Choose your team|Set active event|Sign in again/i }));
  await expect(pickPrimary.first()).toBeVisible();
  if (await page.getByRole("button", { name: /Lock this list/i }).count()) {
    const firstAdd = page.getByRole("button", { name: /^\+ First/i }).first();
    if (await firstAdd.count()) {
      await firstAdd.click();
    }
    await page.getByRole("button", { name: /Lock this list/i }).click();
    await expect(page.locator("body")).not.toContainText("Application error");
  }

  await page.goto("/competition?tab=strategy");
  await expect(page.locator("body")).not.toContainText("Application error");
  const pickDesk = page.getByRole("link", { name: "Pick desk" }).or(
    page.getByRole("tab", { name: "Pick desk" }),
  );
  if (await pickDesk.count()) {
    await pickDesk.first().click();
    await expect(page.locator("body")).not.toContainText("Application error");
  }
});
