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
    await slider.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveValue("19");
    await page.keyboard.press("Home");
    await expect(slider).toHaveValue("2");
    await expect(slider).toBeFocused();
    await expect(panel.getByText("Synced uploads clear automatically. Unsent work stays safe.")).toBeVisible();
    const details = panel.locator("details");
    await expect(details).not.toHaveAttribute("open", "");
    await details.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(details.getByText(/Drafts and unsent reports are never removed/)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(details).not.toHaveAttribute("open", "");
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
