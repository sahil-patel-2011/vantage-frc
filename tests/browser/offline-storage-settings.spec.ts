import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAs } from "./session";

for (const [name, width, height] of [["phone", 390, 844], ["desktop", 1440, 1000]] as const) {
  test(`offline budget persists and remains keyboard accessible on ${name}`, async ({ page, context }) => {
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height });
    await page.goto("/account?tab=appearance");
    await expect(page.getByRole("heading", { name: "Loading account", exact: true })).toBeHidden({ timeout: 20_000 });
    const panel = page.getByRole("region", { name: "Offline storage" });
    const slider = panel.getByRole("slider", { name: "Cache budget" });
    await expect(slider).toBeEnabled();
    await slider.focus();
    await slider.press("End");
    await expect(slider).toHaveValue("20");
    await page.reload();
    await expect(slider).toHaveValue("20");
    const wheel = panel.getByRole("group", { name: "Offline cache size choices" });
    await wheel.getByRole("button", { name: "20 GB", exact: true }).focus();
    await page.keyboard.press("ArrowUp");
    await expect(slider).toHaveValue("19");
    await page.keyboard.press("Home");
    await expect(slider).toHaveValue("2");
    await expect(wheel.getByRole("button", { name: "2 GB", exact: true })).toBeFocused();
    await expect(panel.getByText(/Unsent reports and drafts are never removed/)).toBeVisible();
    await expect(panel.locator(width < 640 ? ".offline-device-touch" : ".offline-device-pointer")).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(width);
    expect((await new AxeBuilder({ page }).include(".offline-storage").analyze()).violations).toEqual([]);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `docs/release/screenshots/offline-storage-${name}.png` });
  });
}

test("marketing explains the scheduled launch and opens a composed early-access email", async ({ page }) => {
  await page.goto("/");
  const notice = page.getByTestId("launch-availability");
  await expect(notice).toContainText("December 1, 2026");
  await expect(notice.getByRole("link", { name: "Contact us for early access" })).toHaveAttribute("href", /^mailto:vantagefrc@gmail.com\?subject=Vantage%20early%20access/);
  await page.goto("/signin");
  await expect(page.getByRole("link", { name: "contact us for early access" })).toBeVisible();
});

test("member menu folds shortcuts without removing destinations", async ({ page, context }) => {
  expect(await signInAs(context, "member")).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Loading account", exact: true })).toBeHidden({ timeout: 20_000 });
  await page.getByRole("button", { name: "Menu and search", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Product navigation" });
  const shortcuts = menu.locator("details.soft-drawer-quick");
  await expect(shortcuts).not.toHaveAttribute("open", "");
  await expect(shortcuts.getByRole("link", { name: "Scout", exact: true })).toBeHidden();
  await shortcuts.locator("summary").click();
  await expect(shortcuts.getByRole("link", { name: "Scout", exact: true })).toBeVisible();
  await expect(shortcuts.getByRole("link", { name: "Chat", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});
