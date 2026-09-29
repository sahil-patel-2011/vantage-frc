import { expect, test } from "@playwright/test";
import { signInAs } from "./session";
import { waitForLoadingGone } from "./ready";

for (const width of [390, 1440]) {
  test("shared icon hit areas stay centered at " + width + "px", async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const route of ["/dashboard", "/competition", "/ai?tab=chat"]) {
      await page.goto(route);
      await waitForLoadingGone(page);
      for (const label of ["Ask AI", "Notifications"]) {
        const control = page.locator(".soft-topbar").getByRole("link", { name: new RegExp("^" + label) });
        await expect(control).toBeVisible();
        await control.hover();
        const target = await control.boundingBox();
        const glyph = await control.locator("svg").boundingBox();
        expect(target).not.toBeNull();
        expect(glyph).not.toBeNull();
        expect(Math.abs(target!.x + target!.width / 2 - glyph!.x - glyph!.width / 2)).toBeLessThan(0.6);
        expect(Math.abs(target!.y + target!.height / 2 - glyph!.y - glyph!.height / 2)).toBeLessThan(0.6);
      }
      if (route.includes("/ai")) {
        await expect(page.locator(' .ch-page [aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
        await expect(page.getByText("No channel", { exact: true })).toHaveCount(0);
        await testInfo.attach("ai-chat-" + width + ".png", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      }
    }
  });
}
