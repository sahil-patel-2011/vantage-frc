import { expect, type BrowserContext } from "@playwright/test";

/** Persist a predictable personal board through the same API Home uses. */
export async function resetHomeBoard(context: BrowserContext, includeSetup = false) {
  const meResponse = await context.request.get("/api/me");
  expect(meResponse.ok()).toBe(true);
  const me = await meResponse.json();
  expect(me.orgId).toBeTruthy();
  const response = await context.request.get(`/api/dashboards?orgId=${me.orgId}&mode=home`);
  expect(response.ok()).toBe(true);
  const boards = await response.json();
  const reset = await context.request.post("/api/dashboards", {
    data: { orgId: me.orgId, action: "reset", id: boards.active?.id ?? null },
  });
  expect(reset.ok(), await reset.text()).toBe(true);
  const { layout } = await reset.json();
  if (includeSetup) layout.push({ i: "fixture-setup", type: "onboarding_checklist", x: 0, y: 30, w: 12, h: 4 });
  const saved = await context.request.post("/api/dashboards", {
    data: { orgId: me.orgId, action: "save", id: boards.active?.id ?? null, name: "My dashboard", scope: "personal", layout },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
}
