import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("My Day still loads after the Saturday shell pass", async ({ page }) => {
  await page.goto("/my-day");
  await expect(page.locator("body")).not.toContainText("Application error");

  // /my-day opens inside the Competition hub, so the h1 belongs to the hub
  // and the page's own heading is "Our matches". Matching the hub title alone
  // would pass on any Competition tab, so the content heading is in here too.
  const title = page.getByRole("heading", { name: /Our matches|My Day|Next match/i });
  const setup = page.getByRole("heading", { name: /Choose your team|Choose your team/i });
  const empty = page.getByRole("heading", { name: /Waiting on the event schedule|Schedule is in/i });
  const unavailable = loadFailureHeading(page);
  if (!(await expectHubReadyOrGate(page, title, empty.or(setup).or(unavailable)))) {
    await page.screenshot({ path: "test-results/my-day-after-shell.png", fullPage: true });
    return;
  }

  await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  await expect(page.getByText("org-scoped")).toHaveCount(0);
  await page.screenshot({ path: "test-results/my-day-after-shell.png", fullPage: true });
});
