import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Connect TBA", "The Blue Alliance", "TBA/Statbotics", "Setup required", "OAuth", "ONSHAPE_"];
/** Video paste names The Blue Alliance as a source. That is not leftover chrome. */
const BANNED_VIDEO = ["Connect TBA", "TBA/Statbotics", "Setup required", "OAuth", "ONSHAPE_"];

async function openStudentPage(page: Parameters<typeof waitForLoadingGone>[0], path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
}

test("student this week can walk Home widgets and remaining Strategy boards", async ({ page }) => {
  test.setTimeout(90_000);

  await openStudentPage(page, "/dashboard");
  const now = page.getByTestId("dash-now");
  await expect(now).toBeVisible();
  await expect(now.getByText("What to do now")).toBeVisible();
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Home still shows ${phrase}`).not.toContainText(phrase);
  }

  for (const route of [
    "/strategy",
    "/strategy/draft",
    "/pick-clock",
    "/chemistry",
    "/alliance-selection-desk",
    "/match-strategy-cards",
  ]) {
    await openStudentPage(page, route);
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${route} still shows ${phrase}`).not.toContainText(phrase);
    }
    await expect(page.getByText("Setup required")).toHaveCount(0);
  }
});

test("student this week can walk Match video", async ({ page }) => {
  test.setTimeout(90_000);

  await openStudentPage(page, "/video-analysis");
  for (const phrase of BANNED_VIDEO) {
    await expect(page.locator("body"), `Video still shows ${phrase}`).not.toContainText(phrase);
  }
  const related = page.getByRole("navigation", { name: /Related/i }).first();
  if (await related.count()) {
    await expect(related).toContainText("Event day");
    await expect(related).toContainText("Match notes");
    await expect(related).toContainText("Match video");
    await expect(related).not.toContainText("AI relays");
  }
  await expect(page.getByText("Setup required")).toHaveCount(0);
});

test("student this week can walk Event day", async ({ page }) => {
  test.setTimeout(90_000);

  await openStudentPage(page, "/command");
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Event day still shows ${phrase}`).not.toContainText(phrase);
  }
  const eventRelated = page.getByRole("navigation", { name: /Related/i }).first();
  if (await eventRelated.count()) {
    await expect(eventRelated.getByRole("link", { name: "Packing" })).toBeVisible();
    await expect(eventRelated.getByRole("link", { name: "Match checklist" })).toBeVisible();
    await expect(eventRelated.getByRole("link", { name: "Tool checkout" })).toBeVisible();
    await expect(eventRelated.getByRole("link", { name: "Inspection" })).toBeVisible();
  }
  await expect(page.getByText("Setup required")).toHaveCount(0);
});

test("student this week can walk Chat", async ({ page }) => {
  test.setTimeout(90_000);

  await openStudentPage(page, "/chat");
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Chat still shows ${phrase}`).not.toContainText(phrase);
  }
  const empty = page.getByRole("button", { name: "New private chat" });
  if (await empty.count()) {
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    await expect(page.locator(".ch-empty-actions a")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Private chat" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Team-shared chat" })).toHaveCount(0);
  }

  await openStudentPage(page, "/messages");
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Team chat still shows ${phrase}`).not.toContainText(phrase);
  }
});
