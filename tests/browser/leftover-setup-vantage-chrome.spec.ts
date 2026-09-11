import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "VANTAGE / FORMS", "TBA/Statbotics", "Sync reference data"];

test("leftover Setup required / VANTAGE Forms chrome is gone from student boards", async ({
  page,
}) => {
  const routes = [
    "/consent",
    "/match-video-index",
    "/event-day-plan",
    "/match-checklist",
    "/tool-checkout",
    "/match-sim",
  ];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("body")).not.toContainText("Application error");
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${route} still shows ${phrase}`).not.toContainText(phrase);
    }
  }
});
