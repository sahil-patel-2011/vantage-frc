import { expect, test } from "@playwright/test";

test("pricing leads with every-feature-every-plan and the hosted AI ladder", async ({ page }) => {
  await page.goto("/pricing");
  await expect(
    page.getByRole("heading", { name: "Every feature on every plan. You are choosing how much AI you want." }),
  ).toBeVisible();
  await expect(page.getByText(/Everything is included on every plan/i).first()).toBeVisible();

  // The four-plan ladder: Free $0 · Pro $20 · Pro+ $60 · Max $100.
  await expect(page.getByRole("heading", { name: "Free", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pro", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pro+", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Max", exact: true })).toBeVisible();
  await expect(page.getByText("$20", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$60", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$100", { exact: true }).first()).toBeVisible();

  // Feature list appears once, not per column, and the BYOK/local story is explicit.
  await expect(page.getByRole("heading", { name: /Everything below is on every plan/i })).toBeVisible();
  await expect(page.getByText(/Ollama, LM Studio/).first()).toBeVisible();
  await expect(page.getByText(/unlimited by Vantage/i).first()).toBeVisible();

  // Honest allowance comparison + no-silent-overage promise + trial + FAQ.
  await expect(page.getByText(/budget models/i).first()).toBeVisible();
  await expect(page.getByText(/hard (cut-?off|stop)/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Try team hosted AI for 7 days/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Buy AI credits", exact: true })).toBeVisible();
  await expect(page.getByText("Is anything locked behind a paid plan?")).toBeVisible();
});
