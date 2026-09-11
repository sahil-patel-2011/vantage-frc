import { expect, test, type Page } from "@playwright/test";
import { loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "Stripe", "OAuth", "STRIPE_", "Onshape OAuth"];

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

test("student this week can walk Business Sponsors, Budget, and Grants", async ({ page }) => {
  test.setTimeout(120_000);
  await stubBusiness(page, livePortal({ schoolFunded: false, sponsorsAllowed: true }));
  await page.goto("/business");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1, name: "Business" })).toBeVisible({
    timeout: 20_000,
  });
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Business still shows ${phrase}`).not.toContainText(phrase);
  }

  const related = page.getByRole("navigation", { name: /Related funding tools/i }).first();
  await expect(related).toBeVisible({ timeout: 20_000 });
  await expect(related.getByRole("link", { name: "Sponsors" })).toBeVisible();
  await expect(related.getByRole("link", { name: "Budget" })).toBeVisible();
  await expect(related.getByRole("link", { name: "Grants" })).toBeVisible();

  const tabs = page.getByRole("tablist", { name: "Business sections" });
  await tabs.getByRole("tab", { name: "Overview" }).click();
  const workingFunds = page.getByLabel("Season funding summary").locator("article", { hasText: "Working funds" });
  await expect(workingFunds.getByText("—")).toBeVisible();
  await expect(workingFunds).not.toContainText("$0");

  await expect(tabs.getByRole("tab", { name: "Sponsors" })).toBeVisible();
  await tabs.getByRole("tab", { name: "Money" }).click();
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("Setup required")).toHaveCount(0);

  await tabs.getByRole("tab", { name: "Sponsors" }).click();
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("Stripe")).toHaveCount(0);

  await tabs.getByRole("tab", { name: "Grants" }).click();
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("Setup required")).toHaveCount(0);

  await page.goto("/budget");
  await expect(page.locator("body")).not.toContainText("Application error");
  const budgetHeading = page.getByRole("heading", { name: /Season budget|Choose your team|The budget is not open to you/i });
  await expect(budgetHeading.or(loadFailureHeading(page)).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Setup required")).toHaveCount(0);

  await page.goto("/team/grants/calendar");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Setup required")).toHaveCount(0);
  await expect(page.getByText("OAuth")).toHaveCount(0);
});
