import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "OAuth", "Join or pick a team", "Account Connections", "RLS"];

test("student this week can walk Team hub People → Invites → Season roles", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/team");
  await expect(page.locator("body")).not.toContainText("Application error");
  await page
    .getByRole("heading", { name: /Loading/i })
    .waitFor({ state: "hidden", timeout: 12_000 })
    .catch(() => undefined);
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Team hub still shows ${phrase}`).not.toContainText(phrase);
  }
  const peopleTab = page.getByRole("tab", { name: "People" }).or(page.getByRole("link", { name: "People" }));
  if (await peopleTab.count()) {
    await expect(peopleTab.first()).toBeVisible();
  }

  await page.goto("/team?tab=attendance");
  await expect(page.locator("body")).not.toContainText("Application error");
  await page
    .getByText("Loading attendance")
    .waitFor({ state: "hidden", timeout: 12_000 })
    .catch(() => undefined);
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `People still shows ${phrase}`).not.toContainText(phrase);
  }
  const peoplePrimary = page
    .getByRole("link", { name: /Choose your team|Create the first roll call|Ask an admin for a roll call|Sign in again/i })
    .or(page.getByRole("button", { name: /Create the first roll call|Retry/i }));
  await expect(peoplePrimary.first()).toBeVisible({ timeout: 12_000 });

  await page.goto("/team/admin");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1, name: "Invites" })).toBeVisible();
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Invites still shows ${phrase}`).not.toContainText(phrase);
  }
  const adminPrimary = page
    .getByRole("link", { name: /Choose your team|Invite an exact email|Sign in again/i })
    .or(page.getByRole("button", { name: /Send invite|Retry/i }));
  await expect(adminPrimary.first()).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText(/waitlist/i).first()).toBeVisible();

  const islandTeam = page.getByTestId("soft-island").getByRole("link", { name: "Team", exact: true });
  if (await islandTeam.isVisible()) {
    const href = await islandTeam.getAttribute("href");
    const orgId = href ? new URL(href, page.url()).searchParams.get("orgId") : null;
    if (orgId) {
      await page.goto(`/team/admin?orgId=${encodeURIComponent(orgId)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Invites" })).toBeVisible();
      for (const phrase of BANNED) {
        await expect(page.locator("body"), `Invites with team still shows ${phrase}`).not.toContainText(
          phrase,
        );
      }
      await expect(page.getByRole("heading", { name: "Add a teammate" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Send invite" })).toBeVisible();
    }
  }

  await page.goto("/roles");
  await expect(page.locator("body")).not.toContainText("Application error");
  await page
    .getByRole("heading", { name: /Loading/i })
    .waitFor({ state: "hidden", timeout: 12_000 })
    .catch(() => undefined);
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Season roles still shows ${phrase}`).not.toContainText(phrase);
  }
  const rolesHeading = page.getByRole("heading", {
    name: /Roles & Responsibilities|Choose your team/i,
  });
  await expect(rolesHeading.first()).toBeVisible({ timeout: 12_000 });
  const rolesPrimary = page
    .getByRole("link", { name: /Choose your team|Sign in again/i })
    .or(page.getByRole("button", { name: /Add role|Retry/i }));
  await expect(rolesPrimary.first()).toBeVisible({ timeout: 12_000 });
});
