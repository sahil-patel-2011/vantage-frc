import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "Statbotics", "The Blue Alliance", "Season EPA"];

test("Research is a student look-up with Needs setup and Rating, not EPA", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/intel", { waitUntil: "domcontentloaded" });
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  const heading = page.getByRole("heading", { level: 1, name: "Research" });
  const setup = page.locator("main").getByRole("heading", { name: "Choose your team", exact: true });
  const unavailable = loadFailureHeading(page);
  if (!(await expectHubReadyOrGate(page, heading, setup.or(unavailable)))) {
    await page.screenshot({ path: "/opt/cursor/artifacts/research-remaining.png", fullPage: true });
    return;
  }
  await expect(heading.first()).toBeVisible();
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Research still shows ${phrase}`).not.toContainText(phrase);
  }
  await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).toBeVisible();
  if (await setup.isVisible()) {
    await expect(page.locator("main").getByText("Needs setup", { exact: true }).first()).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: "Choose your team" })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
  } else if (await page.getByRole("heading", { name: "Look up a team" }).isVisible()) {
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
  }
});
