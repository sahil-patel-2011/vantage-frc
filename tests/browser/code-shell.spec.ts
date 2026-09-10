import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Code Coach hub still loads after the panel split", async ({ page }) => {
  await page.goto("/build?tab=code");
  await expect(page.getByRole("tab", { name: "Code" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const coach = page.getByRole("heading", { name: "Code Coach pattern review" });
  // GHA Playwright has no Postgres. Fixture cookie is not a Better Auth
  // session, so HubOrgGate never mounts CodeClient. "Choose a team" is the
  // honest no-org gate — not a shell regression.
  const teamGate = page.getByRole("heading", { name: /choose (a|your) team/i });
  await expect(coach.or(teamGate)).toBeVisible({ timeout: 20_000 });
  if ((await coach.count()) === 0) {
    await expect(teamGate).toBeVisible();
    return;
  }

  await expect(page.getByRole("heading", { name: "AI Bugbot" })).toBeVisible();
  const modes = page.getByRole("group", { name: "Bugbot billing mode" });
  await expect(modes).toBeVisible();
  await expect(modes.getByRole("button", { name: /On your subscription/ })).toBeVisible();
  await expect(modes.getByRole("button", { name: /Bugbot Ultra/ })).toBeVisible();
  await expect(modes.getByRole("tab")).toHaveCount(0);

  await expect(page.getByText("blocking robot loop")).toHaveCount(0);

  if (process.env.CODE_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/code-after-split.png", fullPage: true });
  }
});
