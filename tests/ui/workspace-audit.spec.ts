import { expect, test } from "@playwright/test";
import { accessible, isolateUi, orgId } from "./fixture";
import { PRODUCT_HUBS, hubHref } from "../../apps/web/lib/nav/hubs";
import { writeFileSync } from "node:fs";

const routes = [
  "/dashboard", "/team", "/team?tab=attendance", "/team?tab=todos", "/team?tab=knowledge", "/team?tab=logistics",
  "/build", "/build?tab=cad", "/build?tab=code", "/build?tab=fmea", "/build?tab=inventory",
  "/business", "/business?tab=finance", "/business?tab=sponsors", "/business?tab=evidence",
  "/ai", "/ai?tab=writer", "/ai?tab=agent", "/ai?tab=budgets", "/ai?tab=decisions", "/ai/connect",
  "/account?tab=appearance", "/notifications", "/forms", "/help", "/security", "/parents", "/reimbursements", "/gearbox", "/team/ai-keys", "/learn/6925",
];
for (const width of [320, 390, 768, 1440]) for (const theme of ["light", "dark"]) test(`workspace recovery states are accessible at ${width}px ${theme}`, async ({ page, context }, info) => {
  test.setTimeout(process.env.PRODUCT_UI_FULL === "1" ? 1_800_000 : 600_000);
  await page.setViewportSize({ width, height: 900 });
  await isolateUi(page, context, theme);
  const findings: Array<{ route: string; error: string }> = [];
  const errors: string[] = [];
  const visited: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const census = process.env.PRODUCT_UI_FULL === "1" ? [...new Set([...routes,
    ...PRODUCT_HUBS.filter(hub => hub.id !== "media").flatMap(hub => hub.tabs.map(tab => hubHref(hub.href, tab.id))),
  ])] : routes;
  for (const route of census) {
    const href = `${route}${route.includes("?") ? "&" : "?"}orgId=${orgId}`;
    try {
      const response = await page.goto(href);
      expect(response?.status(), route).toBe(200);
      await expect(page.locator("main").first()).toBeVisible({ timeout: 25_000 });
      await page.getByRole("heading", { name: /^Loading/ }).first().waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 });
      await expect(page.locator("body")).not.toContainText("Application error");
      await accessible(page);
      await page.screenshot({ path: info.outputPath(`${route.replace(/\W/g, "-")}.png`) });
    } catch (error) { findings.push({ route, error: String(error) }); }
    visited.push(route);
    writeFileSync(info.outputPath("audit.json"), JSON.stringify({ width, theme, visited, findings, errors }, null, 2));
    if (visited.length % 25 === 0) console.log(`UI recovery census: ${visited.length}/${census.length}; ${findings.length} findings`);
  }
  await info.attach("workspace-findings", { path: info.outputPath("audit.json"), contentType: "application/json" });
  expect(errors).toEqual([]);
  expect(findings).toEqual([]);
});
