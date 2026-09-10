import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Chemistry hub still loads after the Saturday shell pass", async ({ page }) => {
  await page.goto("/competition?tab=chemistry");
  await expect(page.getByRole("tab", { name: "Strategy" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const tools = page.getByRole("navigation", { name: "Tools in Strategy" });
  const seats = page.getByRole("heading", { name: "Alliance seats" });
  const empty = page.getByRole("heading", { name: "Waiting on real alliance seats" });
  const setup = page.getByRole("heading", { name: /Choose your team|Choose your team/i });
  const unavailable = loadFailureHeading(page);
  // GHA has no Postgres: HubOrgGate paints Choose your team and never mounts ChemistryClient.
  if (!(await expectHubReadyOrGate(page, seats, empty.or(setup).or(unavailable)))) {
    await page.screenshot({ path: "/opt/cursor/artifacts/chemistry-after-shell.png", fullPage: true });
    return;
  }

  await expect(tools.getByRole("button", { name: "Chemistry", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Strategy" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("org-scoped")).toHaveCount(0);
  await page.screenshot({ path: "/opt/cursor/artifacts/chemistry-after-shell.png", fullPage: true });
});
