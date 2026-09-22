import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

/**
 * What a signed-in account with no team actually sees.
 *
 * This spec used to assert a "Choose your team" setup shell on /team/usage.
 * That shell is only reachable through the auth fixture, which walks past the
 * proxy without minting a session — so the spec was describing a state no real
 * person can be in. With a real session and no membership, the product does
 * something better: it redirects to the team-access page and explains that a
 * team owner has to approve the account.
 *
 * The property worth protecting is the same one it always was, and it is a
 * property about a dead end: a person who cannot get in must be told what is
 * happening in one place, and not be offered a row of links that all lead back
 * to pages they also cannot open.
 */
test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "no-team");
  if (!signed) await signInFixture(context);
});

test("a signed-in account with no team is told what is happening, once", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/team/usage");
  await expect(page.locator("body")).not.toContainText("Application error");

  const main = page.locator("main");
  await expect(
    page.getByRole("heading", { name: "Your profile is ready. Team access is next." }),
  ).toBeVisible();

  // The reason, in the words of somebody who has just been stopped.
  await expect(main).toContainText("A team number never lets you in by itself");

  // No engineering vocabulary on the one screen a blocked person reads.
  await expect(main).not.toContainText("pick a team first");
  await expect(main).not.toContainText("Pick a team first");
  await expect(main).not.toContainText("setup_required");

  // A dead end offers no shortcuts that are also dead ends. The cost page and
  // Chat are not reachable for this account, so linking them here is a second
  // wall. Both spellings, because the nav label changed and the assertion is
  // about the destination, not the words on it.
  await expect(main.getByRole("link", { name: "Pricing" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "What it costs" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Chat" })).toHaveCount(0);
});
