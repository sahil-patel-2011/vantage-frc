import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "VANTAGE /"];

const LEAVES = [
  { path: "/wiring", heading: "CAN-bus map" },
  { path: "/wiring-diagnoser", heading: "Wiring / Power Fault Diagnoser" },
  { path: "/spares", heading: "Consumables" },
] as const;

test("Pit wiring / consumables say Needs setup with one primary", async ({ page }) => {
  test.setTimeout(90_000);

  for (const leaf of LEAVES) {
    await page.goto(leaf.path, { waitUntil: "domcontentloaded" });
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    const heading = page.getByRole("heading", { level: 1 }).filter({ hasText: leaf.heading });
    const setup = page.getByRole("heading", { name: "Choose your team", exact: true });
    const unavailable = loadFailureHeading(page);
    if (!(await expectHubReadyOrGate(page, heading, setup.or(unavailable)))) {
      await page.screenshot({
        path: `/opt/cursor/artifacts/${leaf.path.slice(1)}-pit-remaining.png`,
        fullPage: true,
      });
      continue;
    }
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${leaf.path} still shows ${phrase}`).not.toContainText(phrase);
    }
    if (await setup.isVisible()) {
      await expect(page.getByText("Needs setup").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Choose your team" })).toHaveCount(1);
    } else {
      await expect(heading.first()).toBeVisible();
    }
  }
});
