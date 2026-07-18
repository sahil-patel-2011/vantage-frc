import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { distinctValues, isGenuineConflict, scoutDisagreementStatusLabel, summarizeDisagreements } from ".";
import { computeScoutDisagreementsView } from "./compute-scout-disagreements";
import type { ScoutDisagreement } from "./types";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

/** Returns queued rows in call order — mirrors the sequential query order inside
 * computeScoutDisagreementsView (resolveOrg, items, seasons, [audit]). */
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

describe("computeScoutDisagreementsView", () => {
  it("returns setup_required when the caller has no org membership", async () => {
    const client = queueClient([{ rows: [] }]);
    const view = await computeScoutDisagreementsView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view summarizing open/resolved items and their audit trail", async () => {
    const client = queueClient([
      { rows: [{ orgId: ORG, teamNumber: 118 }] }, // resolveOrg
      {
        rows: [
          {
            id: "dis-open",
            seasonYear: 2026,
            eventKey: "2026test",
            matchNumber: 12,
            teamNumber: 118,
            fieldKey: "autoMobility",
            fieldLabel: "Auto mobility",
            values: [
              { source: "Scout A", value: "true" },
              { source: "Scout B", value: "false" },
            ],
            status: "open",
            resolvedValue: null,
            resolutionNote: null,
            resolvedAt: null,
            createdAt: "2026-02-01T00:00:00.000Z",
          },
          {
            id: "dis-resolved",
            seasonYear: 2026,
            eventKey: "2026test",
            matchNumber: 13,
            teamNumber: 254,
            fieldKey: "climb",
            fieldLabel: "Climb result",
            values: [
              { source: "Scout A", value: "deep" },
              { source: "Scout B", value: "shallow" },
            ],
            status: "resolved",
            resolvedValue: "deep",
            resolutionNote: "Video confirmed",
            resolvedAt: "2026-02-02T00:00:00.000Z",
            createdAt: "2026-02-01T01:00:00.000Z",
          },
        ],
      }, // items
      { rows: [{ seasonYear: 2026 }] }, // seasons
      {
        rows: [
          {
            id: "audit-1",
            disagreementId: "dis-resolved",
            action: "resolved",
            previousStatus: "open",
            newStatus: "resolved",
            resolvedValue: "deep",
            note: "Video confirmed",
            createdAt: "2026-02-02T00:00:00.000Z",
          },
        ],
      }, // audit log
    ]);
    const view = await computeScoutDisagreementsView(client, {
      userId: USER,
      requestedOrg: ORG,
      seasonYear: 2026,
    });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.items).toHaveLength(2);
    expect(view.summary.totalOpen).toBe(1);
    expect(view.summary.totalResolved).toBe(1);
    expect(view.summary.distinctMatches).toBe(2);
    // open items sort ahead of resolved ones in the queue
    expect(view.items[0]?.id).toBe("dis-open");
    expect(view.auditLog).toHaveLength(1);
    expect(view.auditLog[0]?.action).toBe("resolved");
  });
});

describe("scout-disagreements pure helpers", () => {
  function item(overrides: Partial<ScoutDisagreement> = {}): ScoutDisagreement {
    return {
      id: "id",
      seasonYear: 2026,
      eventKey: null,
      matchNumber: 1,
      teamNumber: 118,
      fieldKey: "autoMobility",
      fieldLabel: "Auto mobility",
      values: [
        { source: "Scout A", value: "true" },
        { source: "Scout B", value: "false" },
      ],
      status: "open",
      resolvedValue: null,
      resolutionNote: null,
      resolvedAt: null,
      createdAt: "2026-02-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("labels statuses", () => {
    expect(scoutDisagreementStatusLabel("open")).toBe("Open");
    expect(scoutDisagreementStatusLabel("resolved")).toBe("Resolved");
    expect(scoutDisagreementStatusLabel("dismissed")).toBe("Dismissed");
  });

  it("returns distinct values in first-seen order", () => {
    expect(
      distinctValues([
        { source: "A", value: "true" },
        { source: "B", value: "false" },
        { source: "C", value: "true" },
      ]),
    ).toEqual(["true", "false"]);
  });

  it("flags genuine conflicts only when 2+ distinct values were reported", () => {
    expect(isGenuineConflict([{ source: "A", value: "true" }])).toBe(false);
    expect(
      isGenuineConflict([
        { source: "A", value: "true" },
        { source: "B", value: "true" },
      ]),
    ).toBe(false);
    expect(
      isGenuineConflict([
        { source: "A", value: "true" },
        { source: "B", value: "false" },
      ]),
    ).toBe(true);
  });

  it("summarizes counts and distinct matches/fields across statuses", () => {
    const summary = summarizeDisagreements([
      item({ id: "1", matchNumber: 1, fieldKey: "autoMobility", status: "open" }),
      item({ id: "2", matchNumber: 1, fieldKey: "climb", status: "resolved" }),
      item({ id: "3", matchNumber: 2, fieldKey: "autoMobility", status: "dismissed" }),
    ]);
    expect(summary.totalOpen).toBe(1);
    expect(summary.totalResolved).toBe(1);
    expect(summary.totalDismissed).toBe(1);
    expect(summary.distinctMatches).toBe(2);
    expect(summary.distinctFields).toBe(2);
  });
});
