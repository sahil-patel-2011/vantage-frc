import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { sanitizeSignals, signalKindLabel, signalRoleLabel, summarizeSheets } from ".";
import { computeDriveTeamSignalsView } from "./compute-drive-team-signals";
import type { DriveTeamSignalSheet } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("drive-team-signals pure helpers", () => {
  it("sanitizes malformed signal entries and fills in defaults", () => {
    const signals = sanitizeSignals([
      { id: "s1", kind: "hand_signal", code: "Fist pump", meaning: "Ready for endgame", calledBy: "driver", priority: "critical" },
      { id: "s2", code: "  ", meaning: "no code" },
      { id: "", code: "no id", meaning: "missing id" },
      { id: "s3", kind: "bogus_kind", code: "Cage", meaning: "Move to cage", calledBy: "bogus_role", priority: "bogus_priority" },
    ]);
    expect(signals).toHaveLength(2);
    expect(signals[0]!.code).toBe("Fist pump");
    expect(signals[1]!.kind).toBe("other");
    expect(signals[1]!.calledBy).toBe("driver");
    expect(signals[1]!.priority).toBe("important");
  });

  it("labels kinds and roles", () => {
    expect(signalKindLabel("hand_signal")).toBe("Hand signal");
    expect(signalRoleLabel("human_player")).toBe("Human player");
  });

  it("summarizes sheets into signal counts by kind/priority", () => {
    const sheets: DriveTeamSignalSheet[] = [
      {
        id: "sheet-1",
        title: "2026 Reefscape",
        gameYear: 2026,
        eventKey: null,
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        signals: [
          { id: "s1", kind: "hand_signal", code: "Fist pump", meaning: "Endgame ready", calledBy: "driver", priority: "critical" },
          { id: "s2", kind: "verbal_callout", code: "Cage!", meaning: "Head to cage", calledBy: "human_player", priority: "important" },
        ],
      },
    ];
    const summary = summarizeSheets(sheets);
    expect(summary.totalSheets).toBe(1);
    expect(summary.totalSignals).toBe(2);
    expect(summary.criticalSignals).toBe(1);
    expect(summary.byKind.find((row) => row.kind === "hand_signal")?.count).toBe(1);
    expect(summary.byPriority.find((row) => row.priority === "critical")?.count).toBe(1);
  });
});

describe("computeDriveTeamSignalsView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeDriveTeamSignalsView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view summarizing sheets for the org", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 100 }], rowCount: 1 };
      }
      if (sql.includes("FROM drive_team_signals_sheets")) {
        return {
          rows: [
            {
              id: "sheet-1",
              title: "2026 Reefscape",
              gameYear: 2026,
              eventKey: "2026casj",
              signals: [
                { id: "s1", kind: "hand_signal", code: "Fist pump", meaning: "Endgame ready", calledBy: "driver", priority: "critical" },
              ],
              notes: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeDriveTeamSignalsView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.sheets).toHaveLength(1);
      expect(view.sheets[0]!.signals[0]!.code).toBe("Fist pump");
      expect(view.summary.totalSignals).toBe(1);
      expect(view.summary.criticalSignals).toBe(1);
    }
  });
});
