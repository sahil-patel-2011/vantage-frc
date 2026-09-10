import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Event Day Command still loads after the panel split", async ({ page }) => {
  await page.goto("/command");
  const competition = page.getByRole("heading", { level: 1, name: "Competition" });
  const standalone = page.getByRole("heading", { level: 1, name: /Command|Event Day/i });
  await expect(competition.or(standalone)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const islandTeam = page.getByTestId("soft-island").getByRole("link", { name: "Team", exact: true });
  if (await islandTeam.isVisible()) {
    const href = await islandTeam.getAttribute("href");
    const orgId = href ? new URL(href, page.url()).searchParams.get("orgId") : null;
    if (orgId) {
      await page.goto(`/command?orgId=${encodeURIComponent(orgId)}`);
      await expect(page.getByRole("heading", { level: 1, name: /Competition|Command|Event Day/i })).toBeVisible();
    }
  }

  const nowNext = page.getByRole("heading", { name: "Now / Next" });
  const empty = page.getByRole("heading", { name: /No upcoming matches|No event linked|Set an active event/i });
  const setup = page.getByRole("heading", { name: /Select a team|Choose a team|Set an active event/i });
  const unavailable = page.getByRole("heading", { name: /Could not load Command/i });
  if (!(await expectHubReadyOrGate(page, nowNext, empty.or(setup).or(unavailable)))) {
    if (await empty.isVisible()) {
      await expect(page.getByRole("link", { name: "Check schedule sync" })).toHaveCount(1);
    }
    await page.screenshot({ path: "/opt/cursor/artifacts/command-after-split.png", fullPage: true });
    return;
  }

  await expect(page.getByRole("heading", { name: "Scout next" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Event day" })).toHaveAttribute("aria-selected", "true");

  await page.screenshot({ path: "/opt/cursor/artifacts/command-after-split.png", fullPage: true });
});
