import { describe, expect, it } from "vitest";
import { defaultDashboardLayoutForAudience } from "../../lib/dashboard/catalog";
import {
  dashboardCacheFromHomePayload,
  isDashboardOfflineCache,
  normalizeDashboardCache,
} from "./dashboard-offline-cache";

const layout = defaultDashboardLayoutForAudience("student");

const valid = {
  role: "scout",
  canShareOrg: false,
  boards: [],
  board: { id: "b1", name: "Home", scope: "personal" as const, layout },
  scope: "personal" as const,
  layout,
  widgets: {},
  context: { homeStrip: { audience: "student", items: [] } },
};

describe("dashboard offline cache", () => {
  it("accepts a last-good Home payload and rejects garbage", () => {
    expect(isDashboardOfflineCache(valid)).toBe(true);
    expect(isDashboardOfflineCache(null)).toBe(false);
    expect(isDashboardOfflineCache({ ...valid, scope: "team" })).toBe(false);
    expect(isDashboardOfflineCache({ ...valid, widgets: [] })).toBe(false);
  });

  it("uses the student widget set when the live layout is empty", () => {
    const cache = dashboardCacheFromHomePayload({
      role: "scout",
      canShareOrg: false,
      boards: [],
      active: { id: null, name: "Default home", scope: "personal", layout: [] },
      widgets: {},
      context: { homeStrip: { audience: "student" } },
    });
    expect(cache.layout.map((item) => item.type)).toEqual(
      defaultDashboardLayoutForAudience("student").map((item) => item.type),
    );
    expect(cache.scope).toBe("personal");
  });

  it("fills an empty cached layout from the audience default", () => {
    const cache = normalizeDashboardCache({
      role: null,
      canShareOrg: false,
      boards: [],
      board: { id: null, name: "Default home", scope: "personal", layout: [] },
      scope: "personal",
      layout: [],
      widgets: {},
      context: { homeStrip: { audience: "mentor" } },
    });
    expect(cache.layout.map((item) => item.type)).toEqual(
      defaultDashboardLayoutForAudience("mentor").map((item) => item.type),
    );
  });
});
