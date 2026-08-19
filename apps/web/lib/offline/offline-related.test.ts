import { describe, expect, it } from "vitest";
import {
  OFFLINE_BOOT_RELATED_INCLUDE,
  OFFLINE_SHELL_RELATED_INCLUDE,
  classifyOfflineShell,
  formatOfflineCount,
  offlineBootNextActions,
  offlineBootStatusLine,
  offlineRelatedLinks,
  offlineShellCopy,
  offlineShellNextActions,
  offlineReadinessTone,
} from "./offline-related";

describe("offlineRelatedLinks", () => {
  it("surfaces Scouting first with orgId", () => {
    const links = offlineRelatedLinks("org-1", { include: [...OFFLINE_SHELL_RELATED_INCLUDE] });
    expect(links[0]?.id).toBe("scouting");
    expect(links[0]?.href).toContain("/scouting");
    expect(links[0]?.href).toContain("orgId=org-1");
    expect(links.map((l) => l.id)).toEqual(["scouting", "schedule", "offline", "calendar", "competition"]);
  });

  it("omits active and works without org", () => {
    const links = offlineRelatedLinks(null, {
      active: "offline-shell",
      include: [...OFFLINE_BOOT_RELATED_INCLUDE],
    });
    expect(links.some((l) => l.id === "offline-shell")).toBe(false);
    expect(links.find((l) => l.id === "scouting")?.href).toBe("/scouting");
  });

  it("never uses DEMO labels", () => {
    expect(JSON.stringify(offlineRelatedLinks("org-1"))).not.toMatch(/DEMO/i);
  });
});

describe("formatOfflineCount + status line", () => {
  it("keeps counts blank until loaded and never fabricates", () => {
    expect(formatOfflineCount(3, false)).toBe("…");
    expect(formatOfflineCount(undefined, true)).toBe("0");
    expect(formatOfflineCount(-2, true)).toBe("0");
    expect(formatOfflineCount(12, true)).toBe("12");
  });

  it("builds honest boot status from real outbox counts", () => {
    expect(
      offlineBootStatusLine({
        online: false,
        loaded: true,
        entries: 2,
        media: 1,
        orgRemembered: true,
      }),
    ).toMatch(/Offline · 2 scout entries · 1 media queued · workspace remembered/);
    expect(
      offlineBootStatusLine({
        online: true,
        loaded: true,
        entries: 0,
        media: 0,
        orgRemembered: false,
      }),
    ).toMatch(/Online · scout outbox empty/);
  });
});

describe("classifyOfflineShell + copy", () => {
  it("classifies empty, partial, ready, setup, and error", () => {
    expect(classifyOfflineShell({ loading: true })).toBe("loading");
    expect(classifyOfflineShell({ loading: false, status: "setup_required" })).toBe("setup");
    expect(classifyOfflineShell({ loading: false, status: "live", totalEvents: 0 })).toBe("empty");
    expect(
      classifyOfflineShell({ loading: false, status: "live", totalEvents: 2, tier: "partial" }),
    ).toBe("partial");
    expect(
      classifyOfflineShell({ loading: false, status: "live", totalEvents: 1, tier: "not_ready" }),
    ).toBe("partial");
    expect(classifyOfflineShell({ loading: false, status: "live", totalEvents: 4, tier: "ready" })).toBe(
      "ready",
    );
    expect(classifyOfflineShell({ loading: false, fetchFailed: true })).toBe("error");
  });

  it("refuses invented DEMO sync counts in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "partial", "ready", "error"] as const) {
      const copy = offlineShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).not.toMatch(/DEMO/i);
    }
    expect(offlineShellCopy("empty").description).toMatch(/Empty stays empty/i);
    expect(offlineShellCopy("empty").description).not.toMatch(/DEMO/i);
    expect(offlineShellCopy("setup").description).not.toMatch(/DEMO/i);
  });

  it("maps readiness tones without inventing ready when empty", () => {
    expect(offlineReadinessTone("ready")).toBe("good");
    expect(offlineReadinessTone("partial")).toBe("setup");
    expect(offlineReadinessTone("not_ready")).toBe("demo");
    expect(offlineReadinessTone(null)).toBe("");
  });
});

describe("offlineShellNextActions", () => {
  it("asks for workspace when org is missing", () => {
    const actions = offlineShellNextActions({ shell: "empty" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
  });

  it("points empty at Scouting + log sync", () => {
    const actions = offlineShellNextActions({ orgId: "org-1", shell: "empty" });
    expect(actions[0]?.id).toBe("scouting");
    expect(actions[0]?.href).toContain("orgId=org-1");
    expect(actions.some((a) => a.id === "log-sync")).toBe(true);
  });

  it("points ready at Scouting and Schedule", () => {
    const actions = offlineShellNextActions({ orgId: "org-1", shell: "ready" });
    expect(actions[0]?.id).toBe("scouting");
    expect(actions.some((a) => a.id === "schedule")).toBe(true);
    expect(JSON.stringify(actions)).not.toMatch(/DEMO/i);
  });
});

describe("offlineBootNextActions", () => {
  it("leads with Scouting and Offline Shell readiness", () => {
    const actions = offlineBootNextActions({
      orgId: "org-1",
      online: true,
      loaded: true,
      pendingEntries: 0,
      pendingMedia: 0,
    });
    expect(actions[0]?.id).toBe("scouting");
    expect(actions.some((a) => a.id === "offline-shell")).toBe(true);
  });

  it("mentions real queued counts when offline with outbox items", () => {
    const actions = offlineBootNextActions({
      orgId: "org-1",
      online: false,
      loaded: true,
      pendingEntries: 3,
      pendingMedia: 0,
    });
    expect(actions[0]?.detail).toMatch(/3 item/);
    expect(actions.some((a) => a.id === "stay")).toBe(true);
    expect(JSON.stringify(actions)).not.toMatch(/DEMO/i);
  });
});
