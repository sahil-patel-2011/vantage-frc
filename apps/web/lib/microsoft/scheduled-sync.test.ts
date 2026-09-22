import { describe, expect, it } from "vitest";
import { runScheduledWorkbookSync } from "./scheduled-sync";

describe("runScheduledWorkbookSync", () => {
  it("does nothing when Microsoft is not configured", async () => {
    const previous = process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_ID;
    try {
      const summary = await runScheduledWorkbookSync();
      expect(summary.skipped).toBe("microsoft_not_configured");
      expect(summary.scanned).toBe(0);
    } finally {
      if (previous !== undefined) process.env.MICROSOFT_CLIENT_ID = previous;
    }
  });

  it("syncs each due team once and tallies outcomes, surviving a thrown sync", async () => {
    const seen: string[] = [];
    const summary = await runScheduledWorkbookSync({
      limit: 10,
      deps: {
        listDue: async (limit) => {
          expect(limit).toBe(10);
          return [
            { orgId: "a", userId: "u1" },
            { orgId: "b", userId: "u2" },
            { orgId: "c", userId: "u3" },
            { orgId: "d", userId: "u4" },
          ];
        },
        syncOne: async (orgId) => {
          seen.push(orgId);
          if (orgId === "a") return "synced";
          if (orgId === "b") return "not_allowed";
          if (orgId === "c") throw new Error("graph down");
          return "failed";
        },
      },
    });
    expect(seen).toEqual(["a", "b", "c", "d"]);
    expect(summary).toEqual({ scanned: 4, synced: 1, failed: 2, notAllowed: 1 });
  });

  it("clamps the batch size", async () => {
    let asked = 0;
    await runScheduledWorkbookSync({
      limit: 999,
      deps: { listDue: async (limit) => ((asked = limit), []), syncOne: async () => "synced" },
    });
    expect(asked).toBe(50);
  });
});
