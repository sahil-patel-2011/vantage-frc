import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Team admin setup and leftover boards never say Join or pick a team", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/team/admin");
  // First request to a route compiles it, which outruns the default 5s expect.
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("main")).not.toContainText("Join or pick a team");
  await expect(page.locator("main")).not.toContainText("After you pick a team");
  await expect(page.getByRole("heading", { name: "Choose your team" })).toBeVisible({
    timeout: 20_000,
  });
  // Copy moved from "managing access" to invites when membership closed (ed72529).
  await expect(page.getByText("Choose your team before inviting people")).toBeVisible();
  await expect(page.getByText("After you choose your team")).toBeVisible();

  for (const route of ["/retro", "/build-burndown", "/cross-team-scrim", "/editor/pair"]) {
    await page.goto(route);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("main")).not.toContainText("Join or pick a team");
  }
});
