import { describe, expect, it } from "vitest";
import { computePrintFarmView } from "./compute-print-farm";

type QueryCall = { text: string; params: unknown[] };

function makeMockClient(rowsByCall: unknown[][]) {
  const calls: QueryCall[] = [];
  let callIndex = 0;
  return {
    client: {
      query: async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        const rows = rowsByCall[callIndex] ?? [];
        callIndex += 1;
        return { rows, rowCount: rows.length };
      },
    },
    calls,
  };
}

const NOW = new Date("2026-08-24T12:00:00.000Z");

describe("computePrintFarmView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeMockClient([[]]);
    const view = await computePrintFarmView(client as never, {
      userId: "user-1",
      requestedOrg: null,
      now: NOW,
    });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with honest null metrics when the org is empty", async () => {
    const { client } = makeMockClient([
      [{ orgId: "org-1", teamNumber: 254 }], // resolveOrg
      [], // filaments
      [], // printers
      [], // jobs
      [], // usage
    ]);
    const view = await computePrintFarmView(client as never, {
      userId: "user-1",
      requestedOrg: "org-1",
      now: NOW,
    });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.printers).toEqual([]);
      expect(view.filaments).toEqual([]);
      expect(view.queue).toEqual([]);
      expect(view.estimateBias.value).toBeNull();
      expect(view.estimateBias.reason).toContain("5 completed jobs");
      expect(view.summary.printerCount).toBe(0);
      expect(view.summary.gramsRemainingTotal).toBe(0);
    }
  });

  it("flags queue jobs without estimates and never fabricates a projection for them", async () => {
    const { client } = makeMockClient([
      [{ orgId: "org-1", teamNumber: 254 }],
      [], // filaments
      [
        {
          id: "p1",
          name: "Prusa MK4",
          model: null,
          nozzleMm: "0.40",
          buildXMm: 250,
          buildYMm: 210,
          buildZMm: 220,
          status: "idle",
          statusUpdatedAt: "2026-08-24T09:00:00.000Z",
          equipmentAssetId: null,
          loadedFilamentId: null,
          active: true,
        },
      ],
      [
        {
          id: "j1",
          seasonYear: 2026,
          partName: "Intake spacer",
          quantity: 2,
          purpose: "competition_robot",
          status: "queued",
          priority: "high",
          subsystemId: null,
          subsystemName: "Intake",
          inventoryItemId: null,
          buildTaskId: null,
          printerId: "p1",
          filamentId: null,
          estimatedMinutes: null,
          estimatedGrams: null,
          actualMinutes: null,
          actualGrams: null,
          neededBy: "2026-08-25",
          startedAt: null,
          finishedAt: null,
          failureReason: null,
          reprintOfJobId: null,
          requestedBy: "user-1",
          assignedTo: null,
          createdAt: "2026-08-20T00:00:00.000Z",
        },
      ],
      [], // usage
    ]);
    const view = await computePrintFarmView(client as never, {
      userId: "user-1",
      requestedOrg: "org-1",
      now: NOW,
    });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.queue).toHaveLength(1);
      expect(view.queue[0].needsEstimate).toBe(true);
      expect(view.queue[0].projectedFinishAt).toBeNull();
      expect(view.queue[0].atRisk).toBe(false); // no projection means no at-risk claim
      expect(view.summary.needsEstimateCount).toBe(1);
      expect(view.printers[0].failureRate.value).toBeNull();
      expect(view.printers[0].failureRate.reason).toContain("5 finished jobs");
      expect(view.printers[0].schedule.excludedForNoEstimate).toBe(1);
    }
  });

  it("uses parameterized org-scoped queries only", async () => {
    const { client, calls } = makeMockClient([
      [{ orgId: "org-1", teamNumber: 254 }],
      [],
      [],
      [],
      [],
    ]);
    await computePrintFarmView(client as never, { userId: "user-1", requestedOrg: "org-1", now: NOW });
    for (const call of calls.slice(1)) {
      expect(call.text).toContain("org_id = $1");
      expect(call.params).toEqual(["org-1"]);
    }
  });
});
