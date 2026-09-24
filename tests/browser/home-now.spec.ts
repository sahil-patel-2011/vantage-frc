import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Home shows one What to do now primary without TBA jargon", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/dashboard");
  await waitForLoadingGone(page);
  const now = page.getByTestId("dash-now");
  await expect(now).toBeVisible();
  // "What to do now" is the card's accessible name, not text on the screen.
  // The visible eyebrow was removed on purpose — the card was a label, a
  // heading, a sentence and a button all saying the same thing — and this
  // assertion was left behind looking for the words. A screen reader still
  // hears them, so that is what to check.
  await expect(now).toHaveAttribute("aria-label", "What to do now");
  await expect(page.getByText("Connect TBA")).toHaveCount(0);
  await expect(page.getByText("The Blue Alliance")).toHaveCount(0);
  await expect(page.getByText("Student focus")).toHaveCount(0);
  // While the team is still being set up, the setup list under this card is the action and
  // the card carries no link of its own. Otherwise it has exactly one.
  await expect(now).not.toContainText("Working out what is next", { timeout: 25_000 });
  await page.waitForTimeout(1_500);
  if (/Finish setting up your team/.test(await now.innerText())) {
    await expect(now.getByRole("link")).toHaveCount(0);
    return;
  }
  await expect(now.getByRole("link")).toHaveCount(1);
  const cta = now.getByRole("link").first();
  await expect(cta).toBeVisible();
  await cta.click();
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page).not.toHaveURL(/\/dashboard$/);
});
