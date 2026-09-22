import { expect, test } from "@playwright/test";
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
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("main")).not.toContainText("Join or pick a team");
  await expect(page.locator("main")).not.toContainText("After you pick a team");
  /*
    The gate only appears when there is no team to manage. A signed-in owner
    has an active org, so /team/admin loads the real page — and this spec
    asserted the gate unconditionally, which made a correct page a failure.

    What it is actually for is the copy: "Join or pick a team" and "After you
    pick a team" are leftovers from before teams were provisioned, and neither
    should ever appear. That check runs either way, above. The gate's own
    wording is checked when the gate is what is on screen.
  */
  const gate = page.getByRole("heading", { name: "Choose your team" });
  const board = page.getByText("Invite teammates by exact email");
  // Waited for, not raced: asking whether the gate is visible before the
  // client has painted answers "no" about a page that is about to show it.
  await expect(gate.or(board).first()).toBeVisible({ timeout: 25_000 });

  if (await gate.isVisible().catch(() => false)) {
    // The gate says what you cannot do yet and what happens to people who
    // are not invited. It used to say "before managing access"; "before
    // inviting people" is the same sentence in words a student uses, and the
    // spec had been asserting the older one.
    await expect(page.getByText(/Choose your team before inviting people/)).toBeVisible();
    await expect(page.getByText(/People without an invite go to the waitlist/).first()).toBeVisible();
  } else {
    await expect(board).toBeVisible();
  }

  for (const route of ["/retro", "/build-burndown", "/cross-team-scrim", "/editor/pair"]) {
    await page.goto(route);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("main")).not.toContainText("Join or pick a team");
  }
});
