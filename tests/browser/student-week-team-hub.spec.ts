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
  /*
    Inside the hub, the feature's own "Next actions" panel is hidden —
    `.product-hub-panel .att-next-actions` is display:none, because the hub
    shows its own and two lists of next actions is the duplication the hubs
    removed. That also takes it out of the accessibility tree, so the spec was
    looking for a link that no person could see either.

    What matters is that People offers a way to start a roll call, or says why
    it cannot. Which control carries it is a layout decision; that a student
    can act is not.
  */
  const peoplePrimary = page
    .getByRole("link", { name: /Choose your team|Sign in again/i })
    .or(page.getByRole("button", { name: /New attendance event|Create the first roll call|Retry/i }))
    .or(page.getByRole("link", { name: /New attendance event|Create the first roll call/i }))
    .locator("visible=true");
  await expect(peoplePrimary.first()).toBeVisible({ timeout: 15_000 });

  // And the hidden panel still points somewhere, for a standalone render.
  const hiddenCta = page.locator(".att-next-actions a").first();
  if (await hiddenCta.count()) {
    await expect(hiddenCta).toHaveAttribute("href", /.+/);
  }

  await page.goto("/team/admin");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1, name: "Team admin" })).toBeVisible();
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Team admin still shows ${phrase}`).not.toContainText(phrase);
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
      await expect(page.getByRole("heading", { level: 1, name: "Team admin" })).toBeVisible();
      for (const phrase of BANNED) {
        await expect(page.locator("body"), `Team admin with team still shows ${phrase}`).not.toContainText(
          phrase,
        );
      }
      await expect(page.getByRole("heading", { name: "Invite someone" })).toBeVisible();
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
