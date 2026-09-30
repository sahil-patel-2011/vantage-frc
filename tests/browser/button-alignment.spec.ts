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
        // Desktop moves Ask AI into the rail to avoid two identical shortcuts.
        const surface = label === "Ask AI" && width > 1024 ? page.locator(".vrail") : page.locator(".soft-topbar");
        const control = surface.getByRole("link", { name: new RegExp("^" + label) });
        await expect(control).toBeVisible();
        await control.hover();
        const target = await control.boundingBox();
        const glyph = await control.locator("svg").boundingBox();
        expect(target).not.toBeNull();
        expect(glyph).not.toBeNull();
        if (label === "Ask AI" && width >= 1024) {
          // This is a labeled row, with its icon before the text, rather than an icon-only hit area.
          expect(glyph!.x).toBeGreaterThanOrEqual(target!.x);
          expect(glyph!.x + glyph!.width).toBeLessThanOrEqual(target!.x + target!.width);
          await expect(control).toHaveText("Ask AI");
        } else {
          expect(Math.abs(target!.x + target!.width / 2 - glyph!.x - glyph!.width / 2)).toBeLessThan(0.6);
        }
        expect(Math.abs(target!.y + target!.height / 2 - glyph!.y - glyph!.height / 2)).toBeLessThan(0.6);
      }
      if (route.includes("/ai")) {
        await expect(page.locator(' .ch-page [aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
        await expect(page.getByText("No channel", { exact: true })).toHaveCount(0);
      }
      if (route === "/dashboard") {
        await expect(page.getByTestId("dash-place-canvas")).toBeVisible();
        await expect(page.locator('.dash-home [aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
      }
      await testInfo.attach(route.split("?")[0].slice(1) + "-" + width + ".png", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
    }
  });
}
