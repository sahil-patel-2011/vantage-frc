import { describe, expect, it } from "vitest";
import {
  activeSettingsId,
  isSettingsPath,
  SETTINGS_NAV,
  settingsRoleTier,
  visibleSettingsNav,
} from "./settings-nav";

describe("settings nav model", () => {
  it("every href starts with / and ids are unique", () => {
    const ids = new Set<string>();
    for (const item of SETTINGS_NAV) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
    }
  });

  it("hrefs are unique within each scope", () => {
    for (const scope of ["personal", "team"] as const) {
      const hrefs = SETTINGS_NAV.filter((i) => i.scope === scope).map((i) => i.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });

  it("hrefs are unique in what any single viewer actually sees", () => {
    for (const role of [null, "scout", "viewer", "admin", "owner"]) {
      const hrefs = visibleSettingsNav(role).map((i) => i.href.split("?")[0] + (i.href.includes("tab=") ? i.href : ""));
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });

  it("personal entries never require owner-admin", () => {
    for (const item of SETTINGS_NAV.filter((i) => i.scope === "personal")) {
      expect(item.requiredRole).toBe("member");
    }
  });
});

describe("settingsRoleTier", () => {
  it("maps owner/admin to owner-admin and everything else to member", () => {
    expect(settingsRoleTier("owner")).toBe("owner-admin");
    expect(settingsRoleTier("Admin")).toBe("owner-admin");
    expect(settingsRoleTier("scout")).toBe("member");
    expect(settingsRoleTier("viewer")).toBe("member");
    expect(settingsRoleTier(null)).toBe("member");
    expect(settingsRoleTier(undefined)).toBe("member");
  });
});

describe("visibleSettingsNav", () => {
  it("members see only personal entries", () => {
    const items = visibleSettingsNav("scout");
    expect(items.every((i) => i.scope === "personal")).toBe(true);
    expect(items.map((i) => i.id)).toContain("my-ai-keys");
  });

  it("owners see personal then team, with the AI-keys page deduped to the team entry", () => {
    const items = visibleSettingsNav("owner");
    const ids = items.map((i) => i.id);
    expect(ids).toContain("team-admin");
    expect(ids).toContain("team-ai-keys");
    expect(ids).not.toContain("my-ai-keys");
    // Personal group comes before the team group.
    const firstTeam = items.findIndex((i) => i.scope === "team");
    expect(items.slice(0, firstTeam).every((i) => i.scope === "personal")).toBe(true);
    expect(items.slice(firstTeam).every((i) => i.scope === "team")).toBe(true);
  });

  it("scope filter narrows the list", () => {
    expect(visibleSettingsNav("owner", "team").every((i) => i.scope === "team")).toBe(true);
    expect(visibleSettingsNav("scout", "team")).toEqual([]);
  });
});

describe("isSettingsPath", () => {
  it("matches settings surfaces and their sub-paths only", () => {
    expect(isSettingsPath("/account")).toBe(true);
    expect(isSettingsPath("/security")).toBe(true);
    expect(isSettingsPath("/team/admin")).toBe(true);
    expect(isSettingsPath("/team/ai-policy")).toBe(true);
    expect(isSettingsPath("/exports")).toBe(true);
    expect(isSettingsPath("/accounting")).toBe(false);
    expect(isSettingsPath("/team")).toBe(false);
    expect(isSettingsPath("/dashboard")).toBe(false);
  });
});

describe("activeSettingsId", () => {
  const member = visibleSettingsNav("scout");
  const owner = visibleSettingsNav("owner");

  it("plain /account activates Profile", () => {
    expect(activeSettingsId(member, "/account")).toBe("profile");
    expect(activeSettingsId(member, "/account", "")).toBe("profile");
    expect(activeSettingsId(member, "/account", "?tab=profile")).toBe("profile");
  });

  it("tab query picks the tab entry", () => {
    expect(activeSettingsId(member, "/account", "?tab=appearance")).toBe("appearance");
    expect(activeSettingsId(member, "/account", "tab=notifications")).toBe("notifications");
  });

  it("tab query picks Connections", () => {
    expect(activeSettingsId(member, "/account", "?tab=integrations")).toBe("connections");
  });

  it("matches team routes and ignores unrelated query params", () => {
    expect(activeSettingsId(owner, "/team/ai-keys", "?orgId=abc")).toBe("team-ai-keys");
    expect(activeSettingsId(member, "/team/ai-keys", "?orgId=abc")).toBe("my-ai-keys");
    expect(activeSettingsId(owner, "/team/budgets")).toBe("ai-budgets");
  });

  it("longest path prefix wins and non-settings paths return null", () => {
    expect(activeSettingsId(owner, "/team/admin/anything")).toBe("team-admin");
    expect(activeSettingsId(owner, "/dashboard")).toBeNull();
  });
});
