import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { signInAs } from "./session";

/** Scan the rendered state, including navigation outside the active overlay. */
async function checkAccessibility(page: Page, testInfo: TestInfo, state: string) {
  await page.waitForFunction(() => document.getAnimations().every(animation =>
    animation.effect?.getTiming().iterations === Infinity || animation.playState !== "running",
  ));
  const result = await new AxeBuilder({ page }).analyze();
  await testInfo.attach(`${state}-accessibility.json`, {
    body: JSON.stringify({ url: page.url(), violations: result.violations, incomplete: result.incomplete, passes: result.passes.map(rule => rule.id) }, null, 2),
    contentType: "application/json",
  });
  // Preserve incomplete/manual checks in the report; never exclude a failed rule.
  expect(result.violations, `${state}: automatically detected accessibility violations`).toEqual([]);
}

for (const width of [1280, 390]) {
  test(`shared navigation and event UI accessibility at ${width}px`, async ({ page, context }, testInfo) => {
    test.setTimeout(180_000);
    expect(await signInAs(context, "owner"), "Actual seeded owner sign-in required").toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary apps" })).toBeVisible();
    await checkAccessibility(page, testInfo, "home");

    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await expect(page.getByRole("menu", { name: "Account", exact: true })).toBeVisible();
    await checkAccessibility(page, testInfo, "account");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Menu and search", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Product navigation", exact: true })).toBeVisible();
    await checkAccessibility(page, testInfo, "drawer");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Choose your bottom bar apps", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Your four apps", exact: true })).toBeVisible();
    await checkAccessibility(page, testInfo, "island-editor");
    await page.keyboard.press("Escape");

    const me = await page.request.get("/api/me");
    expect(me.ok()).toBe(true);
    const identity = await me.json() as { authenticated: boolean; orgId: string };
    expect(identity.authenticated).toBe(true);
    expect(identity.orgId).toBeTruthy();
    await page.goto(`/competition?orgId=${encodeURIComponent(identity.orgId)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Competition", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Selected event", exact: true })).toBeVisible();
    await checkAccessibility(page, testInfo, "competition");

    await page.goto("/notifications");
    await expect(page.getByRole("heading", { level: 1, name: "Notifications", exact: true })).toBeVisible();
    await checkAccessibility(page, testInfo, "notifications");

    for (const path of ["/team", "/build", "/business", "/competition?tab=scouting"]) {
      await page.goto(`${path}${path.includes("?") ? "&" : "?"}orgId=${encodeURIComponent(identity.orgId)}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Opening your team", exact: true })).toHaveCount(0);
      // The hub heading can appear before its actual embedded feature data.
      const ready = path === "/team" ? page.locator(".tc-toolbar")
        : path === "/build" ? page.locator(".kick-year")
          : path === "/business" ? page.locator(".biz-season")
            : page.getByRole("button", { name: /^Scout team / }).first();
      await expect(ready).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("main"), "Embedded tools share the workspace's single main landmark").toHaveCount(1);
      await checkAccessibility(page, testInfo, path);
    }
  });
}
