import { expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInFixture } from "../browser/session";
import { ANALYTICS_CONSENT_COOKIE, serializeConsent } from "../../apps/web/lib/product-analytics/consent";

export const orgId = "6925a000-0000-4000-8000-000000000001";
export const userId = "6925a000-0000-4000-8000-000000000002";
export const schemaId = "6925a000-0000-4000-8000-000000000003";
export const definition = { title: "Pit visits", fields: [
  { key: "cycles", label: "Cycle count", type: "number" as const },
  { key: "drive", label: "Drivetrain", type: "select" as const, options: ["Swerve", "Tank"] },
  { key: "notes", label: "Notes", type: "text" as const },
] };
export const schema = { id: schemaId, orgId, year: 2026, type: "pit", version: 1, definition };
export const responses = { definition, rows: [
  { id: "1", team: "frc6925", label: "Pit", event: null, payload: { cycles: 0, drive: "Swerve", notes: "Zero observed" }, observedAt: "2026-10-06T12:00:00Z", mine: true },
  { id: "2", team: "frc254", label: "Pit", event: null, payload: { drive: "Tank" }, observedAt: "2026-10-06T11:00:00Z", mine: false },
], hasMore: false, scouts: null, idle: null };

export async function isolateUi(page: Page, context: BrowserContext, theme = "light", options: { firstRun?: boolean } = {}) {
  await signInFixture(context, !options.firstRun);
  await context.addCookies([{ name: ANALYTICS_CONSENT_COOKIE, value: serializeConsent("denied"), url: "http://127.0.0.1:3419" }]);
  await context.addInitScript(value => {
    localStorage.setItem("vantage-theme", value);
    localStorage.setItem("vantage-theme-pref", value);
  }, theme);
  // Every API request is intercepted. Unknown features deliberately receive a
  // service failure so their recovery UI is tested, with no server data access.
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const json: Record<string, unknown> = {
      "/api/me": { authenticated: true, userId, orgId, name: "Ada", role: "owner", teamNumber: 6925,
        memberships: [{ orgId, orgName: "Test Robotics", role: "owner", teamNumber: 6925 }], hubAccess: null, sponsorsAllowed: true },
      "/api/branding": { org: null, appearance: {} },
      "/api/theme": { theme, persisted: true },
      "/api/navigation/preferences": { tabs: ["/dashboard", "/competition", "/competition?tab=scouting", "/team"] },
      "/api/account": { name: "Ada", email: "ada@example.test", displayName: "Ada", integrations: {} },
      "/api/account/cockpit": { cockpit: {} },
      "/api/scouting/schemas": { userId, eventKey: null, year: 2026, schemas: [schema], canManageSchemas: true },
      "/api/scouting/form-responses": responses,
      "/api/notifications": { status: "ready", userId, unreadCount: 0, items: [] },
    };
    if (path in json) await route.fulfill({ json: json[path] });
    else await route.fulfill({ status: 503, json: { error: "This service is temporarily unavailable. Try again.", status: "unavailable" } });
  });
}

export async function accessible(page: Page, selector?: string) {
  let audit = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
  if (selector) audit = audit.include(selector);
  const result = await audit.analyze();
  expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, issue: n.failureSummary })) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
}
