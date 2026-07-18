import { describe, expect, it } from "vitest";
import {
  QR_HANDOFF_RELATED_INCLUDE,
  classifyQrHandoffQueue,
  classifyQrHandoffShell,
  formatQrHandoffMetric,
  isQrHandoffQueueEmpty,
  qrHandoffNextActions,
  qrHandoffQueueCopy,
  qrHandoffRelatedLinks,
  qrHandoffSetupSteps,
  qrHandoffShellCopy,
} from "./qr-handoff-related";

describe("qrHandoffRelatedLinks", () => {
  it("builds Scouting / Offline via hubHref / withOrgHref", () => {
    const links = qrHandoffRelatedLinks("org-1", {
      include: [...QR_HANDOFF_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "offline"]);
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "offline")?.href).toBe("/offline?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(qrHandoffRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("qrHandoffSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO rows", () => {
    const steps = qrHandoffSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "offline")?.href).toBe("/offline?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("QR handoff Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatQrHandoffMetric(3, true)).toBe("3");
    expect(formatQrHandoffMetric(0, false)).toBe("…");
    expect(formatQrHandoffMetric(-1, true)).toBe("0");
  });

  it("treats zero pending as empty queue", () => {
    expect(isQrHandoffQueueEmpty({ pendingCount: 0 })).toBe(true);
    expect(isQrHandoffQueueEmpty({ pendingCount: 2 })).toBe(false);
  });
});

describe("classifyQrHandoffQueue / qrHandoffQueueCopy", () => {
  it("distinguishes clear queue from synced", () => {
    expect(classifyQrHandoffQueue({ loaded: true, pendingCount: 0, lastSyncedCount: 0 })).toBe(
      "clear",
    );
    expect(classifyQrHandoffQueue({ loaded: true, pendingCount: 0, lastSyncedCount: 4 })).toBe(
      "synced",
    );
    expect(classifyQrHandoffQueue({ loaded: true, pendingCount: 2, lastSyncedCount: 4 })).toBe(
      "queued",
    );
    expect(classifyQrHandoffQueue({ loaded: false })).toBe("loading");
  });

  it("uses different copy for clear vs synced", () => {
    const clear = qrHandoffQueueCopy({ loaded: true, pendingCount: 0, lastSyncedCount: 0 });
    const synced = qrHandoffQueueCopy({ loaded: true, pendingCount: 0, lastSyncedCount: 3 });
    expect(clear.tone).toBe("clear");
    expect(clear.badge).toBe("Queue clear");
    expect(clear.description).toMatch(/empty/i);
    expect(clear.description).not.toMatch(/acknowledgement/i);
    expect(synced.tone).toBe("synced");
    expect(synced.badge).toBe("Synced");
    expect(synced.title).toMatch(/after sync/i);
    expect(synced.description).toMatch(/acknowledgement/i);
    expect(synced.description).toMatch(/not because nothing was scouted/i);
  });
});

describe("classifyQrHandoffShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO rows", () => {
    expect(classifyQrHandoffShell({ loading: true })).toBe("loading");
    expect(classifyQrHandoffShell({ fetchFailed: true, orgId: "o", schemaId: "s" })).toBe("error");
    expect(classifyQrHandoffShell({ orgId: null, schemaId: "s" })).toBe("setup");
    expect(classifyQrHandoffShell({ orgId: "o", schemaId: null })).toBe("setup");
    expect(
      classifyQrHandoffShell({
        orgId: "o",
        schemaId: "s",
        pendingCount: 0,
        lastSyncedCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyQrHandoffShell({
        orgId: "o",
        schemaId: "s",
        pendingCount: 0,
        lastSyncedCount: 2,
      }),
    ).toBe("ready");
    expect(
      classifyQrHandoffShell({
        orgId: "o",
        schemaId: "s",
        pendingCount: 3,
      }),
    ).toBe("ready");
  });
});

describe("qrHandoffShellCopy", () => {
  it("refuses invented DEMO rows in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = qrHandoffShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(qrHandoffShellCopy("empty").badge).toBe("Queue clear");
    expect(qrHandoffShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(qrHandoffShellCopy("setup").badge).toBe("Setup required");
  });
});

describe("qrHandoffNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = qrHandoffNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "offline")).toBe(true);
  });

  it("setup with org points at Scouting / Offline", () => {
    const actions = qrHandoffNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("scouting");
    expect(actions.some((a) => a.id === "offline")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("empty shell points at Scouting / Offline with queue-clear copy", () => {
    const actions = qrHandoffNextActions({
      orgId: "org-1",
      shell: "empty",
      pendingCount: 0,
    });
    expect(actions[0]?.id).toBe("scouting");
    expect(actions[0]?.detail).toMatch(/Queue clear/i);
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["scouting", "offline", "offline-shell"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("synced ready state differs from clear-queue empty", () => {
    const actions = qrHandoffNextActions({
      orgId: "org-1",
      shell: "ready",
      pendingCount: 0,
      lastSyncedCount: 5,
    });
    expect(actions[0]?.id).toBe("scouting");
    expect(actions[0]?.detail).toMatch(/after sync/i);
    expect(actions.some((a) => a.id === "offline")).toBe(true);
  });

  it("queued ready prioritizes share without DEMO rows", () => {
    const actions = qrHandoffNextActions({
      orgId: "org-1",
      shell: "ready",
      pendingCount: 4,
    });
    expect(actions[0]?.id).toBe("share");
    expect(actions[0]?.href).toBe("#scout-qr-share");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "offline")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
