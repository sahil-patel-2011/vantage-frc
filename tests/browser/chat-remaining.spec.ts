import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = [
  "Setup required",
  "FRC Assistant",
  "AI provider not configured",
  "Configure an AI provider key",
  "UsageCutoffBanner",
];

test("Chat remaining student chrome keeps one primary and drops leftover copy", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/chat");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");

  const heading = page.getByRole("heading", { level: 1, name: "Chat" });
  const chooseTeam = page.getByRole("heading", { name: "Choose your team" });
  await expect(heading.or(chooseTeam).first()).toBeVisible();

  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Chat still shows ${phrase}`).not.toContainText(phrase);
  }

  if (await chooseTeam.isVisible()) {
    await expect(page.getByText("Needs setup", { exact: true })).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: "Choose your team" })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    return;
  }

  await expect(heading).toBeVisible();
  const related = page.getByRole("navigation", { name: "Related AI and competition tools" });
  await expect(related).toBeVisible();
  await expect(related.getByRole("link", { name: "Budgets" })).toBeVisible();
  await expect(related.getByRole("link", { name: "Memory" })).toBeVisible();
  await expect(related.getByRole("link", { name: "Strategy" })).toBeVisible();

  const empty = page.getByRole("button", { name: "New private chat" });
  if (await empty.count()) {
    await expect(empty).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Private chat" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Team-shared chat" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enable" })).toHaveCount(0);
    await expect(page.locator(".ch-empty-actions a")).toHaveCount(0);
  }

  const setup = page.getByText("Needs setup", { exact: true });
  if (await setup.isVisible().catch(() => false)) {
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    await expect(page.locator("main").getByRole("link", { name: "Open Team Admin" })).toHaveCount(1);
  }
});
