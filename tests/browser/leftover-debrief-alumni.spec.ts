import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "VANTAGE / MATCH LOG", "VANTAGE / ALUMNI NETWORK"];

test("leftover Match debrief / Alumni / Kickoff / Pit chrome is gone", async ({ page }) => {
  test.setTimeout(120_000);
  const routes = [
    { path: "/match-debrief", heading: /Match debrief|Choose your team/ },
    { path: "/team/alumni", heading: /Alumni|Keep your alumni connected|Choose your team/ },
    { path: "/kickoff", heading: /Kickoff|Choose your team|Choose a team/ },
    { path: "/pit", heading: /Pit command|Choose your team/ },
  ] as const;
  for (const route of routes) {
    await page.goto(route.path);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByRole("heading", { name: route.heading }).first()).toBeVisible();
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${route.path} still shows ${phrase}`).not.toContainText(
        phrase,
      );
    }
  }
});
