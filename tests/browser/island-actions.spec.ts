import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

test("the Your apps editor traps focus, retries a failed save, and persists the chosen order", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  const original = await (await context.request.get("/api/navigation/preferences")).json();
  expect(original.persisted).toBe(true);
  try {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/dashboard?orgId=6925a000-0000-4000-8000-000000000001");
    // No gear: the editor opens from the bar itself (right-click here; press-and-hold or the Menu
    // key elsewhere) or from Edit in the menu, and focus returns to where it was opened from.
    const opener = page.getByRole("navigation", { name: "Primary apps" }).getByRole("link").first();
    await opener.focus();
    await opener.click({ button: "right" });
    const dialog = page.getByRole("dialog", { name: "Your apps" });
    // Cancel on the left takes focus first; Done is on the right.
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    await opener.click({ button: "right" });
    // Remove every pin but Home (the last one can't go), add three, then move Home to the end
    // with the keyboard on its handle.
    const removes = dialog.locator(".pins-editor-remove");
    while (await removes.count() > 1) await removes.nth(1).click();
    await removes.first().click();
    await expect(dialog.getByRole("alert")).toContainText("Keep at least one app pinned.");
    for (const label of ["Money", "Code", "Team chat"]) await dialog.getByRole("button", { name: `Pin ${label}`, exact: true }).click();
    const home = dialog.getByRole("button", { name: /^Move Home, place 1 of 4/ });
    await home.focus();
    await page.keyboard.press("End");
    await expect(dialog.getByRole("button", { name: /^Move Home, place 4 of 4/ })).toBeFocused();
    const labels = ["Money", "Code", "Team chat", "Home"];
    await expect(dialog.locator(".pins-editor-list strong")).toHaveText(labels);

    await page.route("**/api/navigation/preferences", (route) => route.request().method() === "PUT" ? route.fulfill({ status: 503, json: { error: "Save unavailable. Try again." } }) : route.continue());
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Save unavailable");
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeEnabled();
    await page.unroute("**/api/navigation/preferences");
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    const island = page.getByRole("navigation", { name: "Primary apps" });
    await expect(island.getByRole("link")).toHaveText(labels);
    await island.getByRole("link", { name: "Money", exact: true }).click();
    await expect(page).toHaveURL(/\/business\?tab=finance&orgId=6925a000-0000-4000-8000-000000000001/);
  } finally {
    await page.unroute("**/api/navigation/preferences");
    expect((await context.request.put("/api/navigation/preferences", { data: { reset: true } })).ok()).toBe(true);
    if (original.isDefault === false) {
      expect((await context.request.put("/api/navigation/preferences", { data: { tabs: original.tabs } })).ok()).toBe(true);
    }
  }
});
