import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "typical error ±3", "±3 points", "event/year EPA"];

async function openStudentPage(page: Parameters<typeof waitForLoadingGone>[0], path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
}

test("Home, Strategy, and Briefing do not claim season ±3 or invented EPA", async ({ page }) => {
  test.setTimeout(90_000);

  for (const path of ["/dashboard", "/strategy", "/briefing"]) {
    await openStudentPage(page, path);
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${path} still shows ${phrase}`).not.toContainText(phrase);
    }
    await expect(page.getByText("Setup required")).toHaveCount(0);
  }
});
