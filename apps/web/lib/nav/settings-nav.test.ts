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
      const hrefs = visibleSettingsNav(role).map((i) => i.href);
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
  it("members see You only, with their own AI keys and Delete account last", () => {
    const items = visibleSettingsNav("scout");
    expect(items.every((i) => i.scope === "personal")).toBe(true);
    expect(items.map((i) => i.label)).toEqual([
      "Profile",
      "Appearance",
      "Notifications",
      "Security",
      "Your teams",
      "Connectors",
      "Your AI key",
      "Delete account",
    ]);
    expect(items.at(-1)?.danger).toBe(true);
  });

  it("owners see You, then This team in the Settings order, ending with Delete team", () => {
    const items = visibleSettingsNav("owner");
    const team = items.filter((i) => i.scope === "team").map((i) => i.label);
    expect(team).toEqual([
      "Team AI keys",
      "AI limits",
      "AI usage",
      "Members and invites",
      "Access and roles",
      "Money managers",
      "Join code",
      "Team security",
      "Chat safety",
      "Team data and export",
      "Delete team",
    ]);
    // Your key and the team's keys are both rows. They are the same page, two sections.
    expect(items.map((i) => i.id)).toContain("my-ai-keys");
    expect(items.find((i) => i.id === "my-ai-keys")?.href).toBe("/team/ai-keys?focus=yours");
    const firstTeam = items.findIndex((i) => i.scope === "team");
    expect(items.slice(0, firstTeam).every((i) => i.scope === "personal")).toBe(true);
    expect(items.slice(firstTeam).every((i) => i.scope === "team")).toBe(true);
  });

  it("mentors and coaches see the team's settings but not Delete team", () => {
    const ids = visibleSettingsNav("admin").map((i) => i.id);
    expect(ids).toContain("team-admin");
    expect(ids).toContain("join-code");
    expect(ids).not.toContain("delete-team");
  });

  it("scope filter narrows the list", () => {
    expect(visibleSettingsNav("owner", "team").every((i) => i.scope === "team")).toBe(true);
    expect(visibleSettingsNav("scout", "team")).toEqual([]);
  });

  it("every row has a plain one-line detail and search words", () => {
    for (const item of SETTINGS_NAV) {
      expect(item.detail.length).toBeGreaterThan(8);
      expect(item.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe("isSettingsPath", () => {
  it("matches settings surfaces and their sub-paths only", () => {
    expect(isSettingsPath("/account")).toBe(true);
    expect(isSettingsPath("/security")).toBe(true);
    expect(isSettingsPath("/team/admin")).toBe(true);
    expect(isSettingsPath("/team/ai-policy")).toBe(true);
    expect(isSettingsPath("/team/budgets")).toBe(true);
    expect(isSettingsPath("/messages")).toBe(false);
    expect(isSettingsPath("/exports")).toBe(true);
    expect(isSettingsPath("/settings")).toBe(true);
    expect(isSettingsPath("/connectors")).toBe(true);
    expect(isSettingsPath("/messages/moderation")).toBe(true);
    expect(isSettingsPath("/notifications/preferences")).toBe(true);
    expect(isSettingsPath("/notifications")).toBe(false);
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
    expect(activeSettingsId(member, "/notifications/preferences")).toBe("notifications");
  });

  it("never marks a jump within a page (#join-code, #delete-account) as the section", () => {
    expect(activeSettingsId(owner, "/team/admin")).toBe("team-admin");
    expect(activeSettingsId(member, "/account")).toBe("profile");
    expect(activeSettingsId(owner, "/team/admin/profile")).toBe("team-admin");
  });

  it("pages that belong to a section mark it", () => {
    expect(activeSettingsId(owner, "/exports")).toBe("team-data");
    expect(activeSettingsId(owner, "/team/admin/presets")).toBe("access-roles");
    expect(activeSettingsId(member, "/team/ai-keys")).toBe("my-ai-keys");
  });

  it("a tab with no chip activates nothing", () => {
    expect(activeSettingsId(member, "/account", "?tab=integrations")).toBeNull();
  });

  it("matches team routes and ignores unrelated query params", () => {
    expect(activeSettingsId(owner, "/team/ai-keys", "?orgId=abc")).toBe("team-ai-keys");
    expect(activeSettingsId(owner, "/team/ai-keys", "?focus=yours&orgId=abc")).toBe("my-ai-keys");
    expect(activeSettingsId(member, "/team/ai-keys", "?orgId=abc")).toBe("my-ai-keys");
    expect(activeSettingsId(owner, "/team/budgets")).toBe("ai-limits");
    // Chat safety is its own page now, the same one the Team settings chip opens.
    expect(activeSettingsId(owner, "/messages/moderation")).toBe("chat");
  });

  it("longest path prefix wins and non-settings paths return null", () => {
    expect(activeSettingsId(owner, "/team/admin/anything")).toBe("team-admin");
    expect(activeSettingsId(owner, "/team/admin/profile")).toBe("team-admin");
    expect(activeSettingsId(owner, "/dashboard")).toBeNull();
  });
});
