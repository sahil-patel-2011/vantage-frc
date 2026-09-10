import { expect, type Locator, type Page } from "@playwright/test";

/**
 * GHA Playwright does not start Postgres. `signInAs` ECONNREFUSED and the
 * fixture cookie is not a Better Auth session, so HubOrgGate paints this
 * heading and never mounts the feature client. Honest no-org gate, not a
 * shell regression — do not invent an org to make the ToolStrip appear in CI.
 */
export function hubTeamGate(page: Page) {
  return page.getByRole("heading", { name: /choose (a|your) team/i });
}

/**
 * Standalone pages that classify a 401 through `loadFailureCopy` paint this
 * instead of "Could not load X". The fixture cookie is not a Better Auth
 * session, so GHA without Postgres honestly says the session ended.
 */
export function loadFailureHeading(page: Page) {
  return page.getByRole("heading", {
    name: /Your session ended|You don't have access to this|You're offline|Could not load|Something went wrong|Not set up yet/i,
  });
}

/** True when `ready` painted; false on the team gate (and optional recovery). */
export async function expectHubReadyOrGate(
  page: Page,
  ready: Locator,
  recovery?: Locator,
): Promise<boolean> {
  const gate = hubTeamGate(page);
  const timeout = 20_000;
  if (recovery) {
    await expect(ready.or(recovery).or(gate)).toBeVisible({ timeout });
    if ((await ready.count()) === 0) {
      await expect(gate.or(recovery)).toBeVisible();
      return false;
    }
    return true;
  }
  await expect(ready.or(gate)).toBeVisible({ timeout });
  if ((await ready.count()) === 0) {
    await expect(gate).toBeVisible();
    return false;
  }
  return true;
}
