import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Pick clock hub still loads after the Saturday shell pass", async ({ page }) => {
  await page.goto("/competition?tab=pick-clock");
  await expect(page.getByRole("tab", { name: "Strategy" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const tools = page.getByRole("navigation", { name: "Tools in Strategy" });
  // The board is headed "Pick Clock" now; it used to say "45-second pick
  // clock". The old names are kept in the pattern so a deployment that has
  // not caught up still matches.
  /*
    The board's own title is an h1 inside an `.app-page-header`, and the hub
    hides those — it supplies the page's h1 itself. `display:none` takes the
    heading out of the accessibility tree too, so waiting for a heading named
    "Pick Clock" was waiting for something no person could see either.

    This waited quietly for twenty seconds and then failed, and it had been
    "passing" only when an earlier spec happened to leave the board in a state
    where some other matching heading was on screen — which is why it looked
    order-dependent rather than wrong.

    The hero section is what the hub actually shows, so that is what this
    waits for.
  */
  const clock = page.locator(".pck-hero");
  const empty = page.getByRole("heading", { name: "Waiting on a real pick pool" });
  const setup = page.getByRole("heading", { name: /Choose your team|Choose your team/i });
  const unavailable = loadFailureHeading(page);
  // GHA has no Postgres: HubOrgGate paints Choose your team and never mounts PickClockClient.
  if (!(await expectHubReadyOrGate(page, clock, empty.or(setup).or(unavailable)))) {
    await page.screenshot({ path: "test-results/pick-clock-after-shell.png", fullPage: true });
    return;
  }

  await expect(tools.getByRole("button", { name: "Pick clock", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Strategy" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("org-scoped")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/pick-clock-after-shell.png", fullPage: true });
});
