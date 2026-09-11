import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = [
  "Setup required",
  "org- and season-scoped",
  "published schemas",
  "versioned match or pit schemas",
  "TBA/Statbotics",
  "AI provider not configured",
  "Hard usage cutoffs",
  "Connect Onshape with OAuth",
];

test("leftover schema / OAuth chrome is gone from student boards", async ({ page }) => {
  test.setTimeout(90_000);
  const routes = [
    "/competition?tab=forms",
    "/chemistry",
    "/inventory",
    "/inspection-copilot",
    "/learning",
    "/my-kit",
    "/kickoff",
  ];
  for (const route of routes) {
    await page.goto(route);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${route} still shows ${phrase}`).not.toContainText(phrase);
    }
  }
});
