import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Retro, Burndown, Scrim, Pair, and Team admin never say Join or pick a team", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const routes = [
    "/retro",
    "/build-burndown",
    "/cross-team-scrim",
    "/editor/pair",
    "/team/admin",
  ] as const;

  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("body")).not.toContainText("Join or pick a team");
    await expect(page.locator("body")).not.toContainText("Pick a team");
  }
});
