import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("My Hours Clock in is the empty board, not Retry", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/hours-self-view");
  await expect(page.locator("body")).not.toContainText("Application error");
  await page
    .getByRole("heading", { name: /Loading My Hours/i })
    .waitFor({ state: "hidden", timeout: 12_000 })
    .catch(() => undefined);

  await expect(page.getByRole("heading", { name: "My Hours" })).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByText("hour_logs")).toHaveCount(0);

  const clock = page.getByRole("button", { name: /Clock in|Clock out/i });
  const empty = page.getByRole("heading", { name: "Clock in to start your record" });
  await expect(clock.or(empty).first()).toBeVisible({ timeout: 15_000 });

  const clockIn = page.getByRole("button", { name: "Clock in" });
  if (await clockIn.count()) {
    await expect(empty).toBeVisible();
    await clockIn.click();
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.getByText("hour_logs")).toHaveCount(0);
  }
});
