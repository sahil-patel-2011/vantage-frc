import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs } from "./session";

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
