import { expect, test, type Page } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

function livePortal(input: { schoolFunded: boolean; sponsorsAllowed: boolean }) {
  return {
    status: "live",
    orgId: "00000000-0000-4000-8000-000000000001",
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
  await page.route("**/api/business**", async (route) => {
    if (route.request().method() === "GET") {
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

test("school-funded teams without sponsors land on Money and hide CRM", async ({ page }) => {
  await stubBusiness(page, livePortal({ schoolFunded: true, sponsorsAllowed: false }));
  await page.goto("/business");

  const tabs = page.getByRole("tablist", { name: "Business sections" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Overview" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Money" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Sponsors" })).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "Money" })).toHaveAttribute("aria-selected", "true");

  await tabs.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Know the number before saying yes." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open CRM" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open sponsors" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sponsor CRM" })).toHaveCount(0);
});

test("a Sponsors deep-link is sent back to Overview when sponsors are not allowed", async ({ page }) => {
  await stubBusiness(page, livePortal({ schoolFunded: true, sponsorsAllowed: false }));
  await page.goto("/business?tab=sponsors");

  const tabs = page.getByRole("tablist", { name: "Business sections" });
  await expect(tabs.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab", { name: "Sponsors" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Know the number before saying yes." })).toBeVisible();
});

test("sponsored teams still offer the Sponsors workbench", async ({ page }) => {
  await stubBusiness(page, livePortal({ schoolFunded: false, sponsorsAllowed: true }));
  await page.goto("/business");

  const tabs = page.getByRole("tablist", { name: "Business sections" });
  await expect(tabs.getByRole("tab", { name: "Sponsors" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Sponsors" })).toHaveAttribute("aria-selected", "true");
});
