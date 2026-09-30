import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAs } from "./session";
import { waitForLoadingGone } from "./ready";

// This checks presentation and shell integrity. Functional journeys have their
// own assertions; rendering a route is not evidence that its workflow works.
const routes = ["/dashboard", "/competition", "/team", "/build", "/business", "/scouting", "/ai", "/account", "/onboarding", "/"];

for (const width of [320, 768, 1440]) {
  test(`workspace presentation at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(300_000);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(`${new URL(page.url()).pathname}: ${error.message}`));
    for (const route of routes) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBeLessThan(400);
      await waitForLoadingGone(page);
      expect(new URL(page.url()).pathname, route).not.toBe("/signin");
      expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(width + 1);
      expect(await page.getByRole("button", { name: /open (navigation|menu)/i }).count(), route).toBeLessThanOrEqual(1);
      const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(accessibility.violations.map(v => `${v.id}: ${v.nodes.length} nodes`), route).toEqual([]);
      const name = `${route.replace(/\W/g, "") || "marketing"}-${width}.png`;
      const path = info.outputPath(name);
      await page.screenshot({ path });
      await info.attach(name, { path, contentType: "image/png" });
    }
    expect(errors).toEqual([]);
  });
}
