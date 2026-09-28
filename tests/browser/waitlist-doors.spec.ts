import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

/**
 * The scheduled date, production acceptance and operator switch must all pass.
 * The administrator can see each condition without inspecting source code.
 *
 * These run as the platform-admin fixture. Nothing else can reach /admin —
 * which is the other half of what this checks.
 */
test.describe("public sign-up status", () => {
  test("the waitlist page says whether the doors are open, and what is left to do", async ({
    context,
    page,
  }) => {
    test.skip(!(await signInAs(context, "platform")), "no platform-admin fixture on this box");

    await page.goto("/admin/waitlist");
    const doors = page.locator(".admin-signup-doors");
    await expect(doors).toBeVisible();

    // One of the two states, never a blank or a guess.
    await expect(doors).toContainText(/Invite-only|Open to everyone/);

    // All three conditions are visible and the date cannot be silently bypassed.
    const steps = doors.locator(".admin-signup-steps li");
    await expect(steps).toHaveCount(3);
    await expect(steps.first()).toContainText("December 1");
    const open = (await doors.getAttribute("data-open")) === "yes";
    const doneCount = await doors.locator('.admin-signup-steps li[data-done="yes"]').count();
    expect(open).toBe(doneCount === 3);
  });

  test("an owner who is not a platform admin cannot see any of it", async ({ context, page }) => {
    test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");

    await page.goto("/admin/waitlist");
    await expect(page.locator(".admin-signup-doors")).toHaveCount(0);
    // Not even the existence of the queue: the route answers 404 to non-admins.
    await expect(page.locator("body")).not.toContainText("VANTAGE_PUBLIC_SIGNUP");
  });
});
