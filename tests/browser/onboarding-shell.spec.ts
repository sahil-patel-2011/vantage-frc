import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Onboarding still loads after the panel split", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page.locator("body")).not.toContainText("Application error");

  // Complete profiles leave /onboarding for Home. Fixture/GHA without a
  // Better Auth session stay on the signed-in-session gate. Neither path
  // mounts a nested TabBar.
  const flow = page.getByRole("heading", {
    name: /Loading your secure session|Onboarding needs a signed-in session|Set up Vantage around your role|Your profile is ready|You're in/,
  });
  const home = page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening)/i });
  const signIn = page.getByRole("heading", { name: /Sign in/i });
  await expect(flow.or(home).or(signIn)).toBeVisible({ timeout: 20_000 });
  if (new URL(page.url()).pathname === "/onboarding") {
    await expect(page.getByRole("tab")).toHaveCount(0);
  }

  if (process.env.ONBOARDING_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/onboarding-after-split.png", fullPage: true });
  }
});
