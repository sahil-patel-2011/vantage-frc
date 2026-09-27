import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

test("bottom bar customization traps focus, retries a failed save, and persists the chosen order", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  const original = await (await context.request.get("/api/navigation/preferences")).json();
  expect(original.persisted).toBe(true);
  try {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/dashboard?orgId=6925a000-0000-4000-8000-000000000001");
    const opener = page.getByRole("button", { name: "Choose your bottom bar apps" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Your four apps" });
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    const selected = dialog.locator('.soft-island-choice-grid button[aria-pressed="true"]');
    while (await selected.count()) await selected.first().click();
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    const labels = ["Business", "Build", "Team", "Home"];
    for (const label of labels) await dialog.locator(".soft-island-choice-grid button").filter({ has: page.getByText(label, { exact: true }) }).click();
    await page.route("**/api/navigation/preferences", (route) => route.request().method() === "PUT" ? route.fulfill({ status: 503, json: { error: "Save unavailable. Try again." } }) : route.continue());
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Save unavailable");
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await page.unroute("**/api/navigation/preferences");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    const island = page.getByRole("navigation", { name: "Primary apps" });
    await expect(island.getByRole("link")).toHaveText(labels);
    await island.getByRole("link", { name: "Business", exact: true }).click();
    await expect(page).toHaveURL(/\/business\?orgId=6925a000-0000-4000-8000-000000000001/);
    await expect(page.getByRole("heading", { name: "Business", exact: true })).toBeVisible();
  } finally {
    await page.unroute("**/api/navigation/preferences");
    expect((await context.request.put("/api/navigation/preferences", { data: { tabs: original.tabs } })).ok()).toBe(true);
  }
});
