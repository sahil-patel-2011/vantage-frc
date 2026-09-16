import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

let realSession = false;

test.beforeEach(async ({ context }) => {
  realSession = await signInAs(context, "owner");
  if (!realSession) await signInFixture(context);
});

test("Home shows one What to do now primary without TBA jargon", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/dashboard");
  await waitForLoadingGone(page);
  const now = page.getByTestId("dash-now");
  await expect(now).toBeVisible();
  await expect(now.getByText("What to do now")).toBeVisible();
  await expect(now.getByRole("link")).toHaveCount(1);
  await expect(page.getByText("Connect TBA")).toHaveCount(0);
  await expect(page.getByText("The Blue Alliance")).toHaveCount(0);
  await expect(page.getByText("Student focus")).toHaveCount(0);
  const cta = now.getByRole("link").first();
  await expect(cta).toBeVisible();

  // The fixture cookie walks the proxy but mints no Better Auth session, so
  // every destination this card offers bounces through /signin back to Home.
  // Without a real session the most we can prove is that it points somewhere.
  if (!realSession) {
    await expect(cta).toHaveAttribute("href", /^\/[a-z]/);
    return;
  }

  await cta.click();
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page).not.toHaveURL(/\/dashboard$/);
});
