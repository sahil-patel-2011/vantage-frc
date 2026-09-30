import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

for (const width of [390, 1440]) {
  test(`Home controls and live card links remain usable at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    const controls = page.getByRole("group", { name: "Home layout", exact: true });
    const board = controls.getByTestId("dash-board-chip");
    const edit = controls.getByTestId("dash-customize");
    await expect(board).toBeVisible({ timeout: 30_000 });
    await expect(edit).toBeVisible();
    const positions = await controls.locator(":scope > .dash-board-chip-wrap > button, .dash-edit-button").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
    expect(positions).toHaveLength(2);
    expect(Math.abs(positions[0] - positions[1])).toBeLessThanOrEqual(2);
    await board.click();
    await expect(page.getByTestId("dash-board-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(board).toBeFocused();
    await edit.click();
    await expect(page.getByTestId("dash-edit-toolbar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("dash-edit-toolbar")).toHaveCount(0);
    const openCard = page.locator(".dash-widget-open").first();
    await expect(openCard).toBeVisible();
    const heading = openCard.locator("..");
    await expect(heading).toHaveAccessibleName((await heading.innerText()).trim());
    await expect(page.locator(".dash-widget > .dash-widget-link")).toHaveCount(0);
    const destination = await openCard.getAttribute("href");
    expect(destination).toMatch(/^\//);
    const audit = await new AxeBuilder({ page }).analyze();
    await info.attach("home-accessibility.json", { body: JSON.stringify(audit), contentType: "application/json" });
    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`home-polished-${width}.png`), fullPage: true });
    await openCard.click();
    await expect(page).toHaveURL(url => url.pathname === new URL(destination!, url.origin).pathname);
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  test(`workspace selection starts its data request immediately at ${width}px`, async ({ page, context }) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    const identity = await (await context.request.get("/api/me")).json();
    expect(identity.orgId).toBeTruthy();
    // Warm the chunk before measuring: development compilation is not product latency.
    await page.goto(`/team?tab=todos&orgId=${identity.orgId}`);
    await expect(page.locator(".product-hub-panel")).toContainText("One work view", { timeout: 30_000 });
    await page.goto(`/team?orgId=${identity.orgId}`);
    await expect(page.locator(".tc-toolbar")).toBeVisible({ timeout: 30_000 });
    const request = page.waitForRequest(r => new URL(r.url()).pathname === "/api/todos", { timeout: 5_000 });
    await page.getByRole("tab", { name: "Work", exact: true }).click();
    await request;
    await expect(page.locator(".product-hub-panel")).toHaveAttribute("data-hub-tab", "todos");
    await expect(page.locator(".product-hub-panel")).toContainText("One work view", { timeout: 30_000 });
  });
}
