import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Showcase has student chrome without VANTAGE leftover", async ({ page }) => {
  await page.goto("/showcase");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("VANTAGE /")).toHaveCount(0);
  await expect(page.getByText("does not invent")).toHaveCount(0);
  await expect(page.getByText("SEASON IMPACT / SHOWCASE")).toHaveCount(0);
});

test("Prompts has student chrome without VANTAGE leftover", async ({ page }) => {
  await page.goto("/team/prompts");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1, name: "Prompts" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("VANTAGE /")).toHaveCount(0);
  await expect(page.getByText("AI PROMPT LIBRARY")).toHaveCount(0);
});

test("Ask AI history has student chrome without VANTAGE leftover", async ({ page }) => {
  await page.goto("/team/ai-runs");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1, name: "Ask AI history" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("VANTAGE /")).toHaveCount(0);
  await expect(page.getByText("orchestrator")).toHaveCount(0);
});

test("Awards has student chrome and one Choose your team primary", async ({ page }) => {
  await page.goto("/team/awards");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1, name: "Awards" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("VANTAGE /")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Choose your team" })).toBeVisible();
});

test("Desktop install copy has no CLI or OAuth dump", async ({ page }) => {
  await page.goto("/desktop");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1, name: /Vantage on the desktop/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("vantage-cad")).toHaveCount(0);
  await expect(page.getByText("OAuth")).toHaveCount(0);
  await expect(page.getByText("npm run desktop:dist")).toHaveCount(0);
});
