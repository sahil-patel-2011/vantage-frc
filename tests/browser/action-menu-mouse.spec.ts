import { expect, test } from "@playwright/test";
import { signInAs } from "./session";
import { gotoAsTeam } from "./active-org";

// A mouse click on "More" opened the menu and a scroll caused by moving focus into it closed
// it again within 50 ms; only the keyboard could reach Edit, Duplicate and Delete.
test("a saved TV board's More menu stays open after a mouse click", async ({ page, context }) => {
  const signed = await signInAs(context, "owner");
  test.skip(!signed, "no local session");
  const orgId = await gotoAsTeam(page, "/display");
  expect(orgId).toBeTruthy();
  // Each shard starts empty. Create our own board through its actual form,
  // rather than relying on a previous spec to leave one behind.
  const name = `Mouse menu fixture ${Date.now()}`;
  let boardId: string | null = null;
  try {
    await page.getByText("Build your own board", { exact: true }).click();
    await page.getByLabel("Board name", { exact: true }).fill(name);
    const saved = page.waitForResponse(response => response.url().endsWith("/api/display/boards") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Save board", exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const body = await response.json() as { id: string };
    boardId = body.id;
    expect(boardId).toMatch(/^[0-9a-f-]{36}$/i);
    const more = page.getByTestId(`board-menu-${boardId}`);
    await expect(more).toBeVisible();
    await more.click();
    for (const action of ["Edit", "Duplicate", "Delete"]) {
      // Destructive actions include their scope hint in the accessible name.
      await expect(page.getByRole("menuitem", { name: new RegExp(`^${action}(?:$|\\s)`) })).toBeVisible();
    }
    await expect(more).toHaveAttribute("aria-expanded", "true");
  } finally {
    if (boardId) {
      const removed = await page.request.delete("/api/display/boards", { data: { orgId, boardId } });
      expect(removed.ok(), "Remove only this test's identified board").toBe(true);
    }
  }
});
