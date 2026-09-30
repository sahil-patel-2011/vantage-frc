import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs } from "./session";

for (const width of [320, 390]) {
  test(`a running-late match stays inside the Home card at ${width}px`, async ({ page, context }) => {
    expect(await signInAs(context, "owner")).toBe(true);
    await page.clock.install({ time: new Date(Date.now() + 7 * 24 * 60 * 60_000) });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await waitForLoadingGone(page);
    const clock = page.locator(".dash-next-match.nm .nm-clock");
    await expect(clock).toContainText("Running late");
    const bounds = await clock.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const width of [1280, 390]) {
  test(`Home reads compactly and keeps its saved edit grid at ${width}px`, async ({ page, context }, testInfo) => {
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await waitForLoadingGone(page);

    const canvas = page.getByTestId("dash-place-canvas");
    const cards = canvas.getByTestId("dash-grid-item");
    await expect(cards.first()).toBeVisible();
    await expect(canvas).toHaveAttribute("data-editing", "false");
    await expect(canvas).toHaveCSS("display", width === 390 ? "flex" : "grid");
    await expect(cards.first()).toHaveCSS("position", "relative");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await testInfo.attach(`home-reading-${width}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await page.getByTestId("dash-customize").click();
    await expect(canvas).toHaveAttribute("data-editing", "true");
    await expect(cards.first()).toHaveCSS("position", "absolute");
    await expect(page.getByTestId("dash-drag-handle").first()).toBeVisible();
  });
}
