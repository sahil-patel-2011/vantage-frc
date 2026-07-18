import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { relayDeviceRoleLabel, relaySessionStatusLabel, summarizeRelay, summarizeSessionEntries } from ".";
import { computeScoutP2pRelayView } from "./compute-scout-p2p-relay";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

/** Returns queued rows in call order — mirrors the sequential query order inside
 * computeScoutP2pRelayView (resolveOrg, sessions, seasons, [entries]). */
function queueClient(responses: Array<{ rows: unknown[] }>): PoolClient {
  let index = 0;
  return {
    query: vi.fn().mockImplementation(async () => {
      const response = responses[index] ?? { rows: [] };
      index += 1;
      return response;
    }),
  } as unknown as PoolClient;
}

describe("computeScoutP2pRelayView", () => {
  it("returns setup_required when the caller has no org membership", async () => {
    const client = queueClient([{ rows: [] }]);
    const view = await computeScoutP2pRelayView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with no sessions when the org has not run a relay yet", async () => {
    const client = queueClient([
      { rows: [{ orgId: ORG, teamNumber: 118 }] }, // resolveOrg
      { rows: [] }, // sessions
      { rows: [] }, // seasons
    ]);
    const view = await computeScoutP2pRelayView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.sessions).toEqual([]);
      expect(view.summary.totalSessions).toBe(0);
      expect(view.summary.uplinkRate).toBe(0);
    }
  });

  it("aggregates device merge entries into session rollups and an org summary", async () => {
    const client = queueClient([
      { rows: [{ orgId: ORG, teamNumber: 118 }] }, // resolveOrg
      {
        rows: [
          {
            id: "session-1",
            eventKey: "2026test",
            seasonYear: 2026,
            captainDeviceLabel: "Captain iPad",
            status: "open",
            startedAt: "2026-03-01T12:00:00.000Z",
            closedAt: null,
          },
        ],
      }, // sessions
      { rows: [{ seasonYear: 2026 }] }, // seasons
      {
        rows: [
          {
            id: "entry-1",
            sessionId: "session-1",
            deviceLabel: "Scout Tablet A",
            deviceRole: "scout",
            entriesContributed: 8,
            conflictsResolved: 1,
            uplinked: true,
            mergedAt: "2026-03-01T12:05:00.000Z",
          },
          {
            id: "entry-2",
            sessionId: "session-1",
            deviceLabel: "Scout Tablet B",
            deviceRole: "scout",
            entriesContributed: 4,
            conflictsResolved: 0,
            uplinked: false,
            mergedAt: "2026-03-01T12:06:00.000Z",
          },
        ],
      }, // entries
    ]);
    const view = await computeScoutP2pRelayView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.sessions).toHaveLength(1);
    const session = view.sessions[0];
    expect(session.deviceCount).toBe(2);
    expect(session.entriesMerged).toBe(12);
    expect(session.conflictsResolved).toBe(1);
    expect(session.uplinkRate).toBeCloseTo(8 / 12);
    expect(view.summary.totalSessions).toBe(1);
    expect(view.summary.openSessions).toBe(1);
    expect(view.summary.totalEntriesMerged).toBe(12);
    expect(view.summary.uplinkRate).toBeCloseTo(8 / 12);
  });
});

describe("scout-p2p-relay pure helpers", () => {
  it("labels session status and device role for display", () => {
    expect(relaySessionStatusLabel("open")).toMatch(/open/i);
    expect(relaySessionStatusLabel("closed")).toMatch(/closed/i);
    expect(relayDeviceRoleLabel("captain")).toBe("Captain tablet");
    expect(relayDeviceRoleLabel("scout")).toBe("Scout tablet");
  });

  it("rolls per-device entries up into a session aggregate with uplink rate", () => {
    const rollup = summarizeSessionEntries([
      {
        id: "1",
        sessionId: "s",
        deviceLabel: "A",
        deviceRole: "scout",
        entriesContributed: 10,
        conflictsResolved: 2,
        uplinked: true,
        mergedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "2",
        sessionId: "s",
        deviceLabel: "B",
        deviceRole: "scout",
        entriesContributed: 10,
        conflictsResolved: 0,
        uplinked: false,
        mergedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(rollup.deviceCount).toBe(2);
    expect(rollup.entriesMerged).toBe(20);
    expect(rollup.conflictsResolved).toBe(2);
    expect(rollup.uplinkRate).toBeCloseTo(0.5);
  });

  it("returns zeroed summary for an empty session list", () => {
    const summary = summarizeRelay([]);
    expect(summary.totalSessions).toBe(0);
    expect(summary.uplinkRate).toBe(0);
  });
});
