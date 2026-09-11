import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "VANTAGE /"];

const LEAVES = [
  { path: "/safety", heading: "Safety log" },
  { path: "/incidents", heading: "Safety Incident Log" },
  { path: "/safety-training", heading: "Safety Training" },
  { path: "/incident-heatmap", heading: "Incident Heatmap" },
] as const;

test("safety / incidents student boards say Needs setup with one primary", async ({ page }) => {
  test.setTimeout(90_000);

  for (const leaf of LEAVES) {
    await page.goto(leaf.path);
    await expect(page.locator("body")).not.toContainText("Application error");
    const heading = page.getByRole("heading", { level: 1 }).filter({ hasText: leaf.heading });
    const setup = page.locator("main").getByRole("heading", { name: "Choose your team", exact: true });
    const unavailable = loadFailureHeading(page);
    if (!(await expectHubReadyOrGate(page, heading, setup.or(unavailable)))) {
      await page.screenshot({
        path: `/opt/cursor/artifacts/${leaf.path.slice(1)}-safety-incidents.png`,
        fullPage: true,
      });
      continue;
    }

    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${leaf.path} still shows ${phrase}`).not.toContainText(phrase);
    }

    if (await setup.isVisible()) {
      await expect(page.locator("main").getByText("Needs setup", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
      await expect(page.locator("main").getByRole("link", { name: "Choose your team" })).toHaveCount(1);
    } else {
      await expect(heading.first()).toBeVisible();
    }
  }
});
