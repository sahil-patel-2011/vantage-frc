import { expect, test, type Page } from "@playwright/test";
import { signInAs, signInFixture } from "./session";
import { openMenuSection } from "./nav";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

// Complete background fixture requests before Playwright disposes the page.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

function livePortal(input: { schoolFunded: boolean; sponsorsAllowed: boolean }) {
  return {
    status: "live",
    orgId: "6925a000-0000-4000-8000-000000000001",
    orgName: "E2E Team",
    teamNumber: 6925,
    role: "owner",
    canManageFinance: true,
    seasonYear: 2026,
    seasons: [2026],
    schoolFunded: input.schoolFunded,
    sponsorsAllowed: input.sponsorsAllowed,
    budget: {
      totalBudgetCents: 0,
      fundraisingGoalCents: 0,
      sponsorIncomeCents: 0,
      grantIncomeCents: 0,
      requestedCents: 0,
      committedCents: 0,
      spentCents: 0,
      remainingCents: 0,
      monthlySpend: [],
    },
    impact: { activities: 0, hours: 0, peopleReached: 0 },
    categories: [],
    purchases: [],
    sponsors: [],
    fundraisingProgress: {
      goalCents: 0,
      actualCashCents: 0,
      grantIncomeCents: 0,
      actualCents: 0,
      pledgedPipelineCents: 0,
      remainingCents: 0,
      percentOfGoal: 0,
      stages: [],
    },
    sponsorReminders: [],
    interactions: [],
    prospects: [],
    grants: [],
    awards: [],
    drafts: [],
  };
}

async function stubBusiness(page: Page, payload: ReturnType<typeof livePortal>) {
  await page.route("**/api/me**", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), sponsorsAllowed: payload.sponsorsAllowed } });
  });
  await page.route("**/api/business**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "GET" && path === "/api/business") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
      return;
    }
    await route.continue();
  });
}

test("school-funded teams without sponsors open on Overview and hide CRM", async ({ page }) => {
  await stubBusiness(page, livePortal({ schoolFunded: true, sponsorsAllowed: false }));
  await page.goto("/business");

  await expect(page.locator(".workspace-hub-header h1")).toHaveText("Overview");
  const tabs = await openMenuSection(page, "Business");
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Money" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Sponsors" })).toHaveCount(0);
  // /business always opens on Overview unless the link names a tab.
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Set your season budget" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open CRM" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open sponsors" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sponsor CRM" })).toHaveCount(0);
});

test("a Sponsors deep-link is sent back to Overview when sponsors are not allowed", async ({ page }) => {
  await stubBusiness(page, livePortal({ schoolFunded: true, sponsorsAllowed: false }));
  await page.goto("/business?tab=sponsors");

  await expect(page.locator(".workspace-hub-header h1")).toHaveText("Overview");
  const tabs = await openMenuSection(page, "Business");
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Sponsors" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Set your season budget" })).toBeVisible();
});

test("sponsored teams still offer the Sponsors workbench", async ({ page }) => {
  await stubBusiness(page, livePortal({ schoolFunded: false, sponsorsAllowed: true }));
  await page.goto("/business");

  await expect(page.locator(".workspace-hub-header h1")).toHaveText("Overview");
  const tabs = await openMenuSection(page, "Business");
  await expect(tabs.getByRole("link", { name: "Sponsors" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
});
