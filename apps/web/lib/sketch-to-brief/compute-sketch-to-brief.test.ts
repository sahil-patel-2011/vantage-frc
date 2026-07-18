import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeSketchToBriefView } from "./compute-sketch-to-brief";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

/** Returns queued rows in call order — mirrors the sequential/Promise.all query
 * order inside computeSketchToBriefView. */
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

describe("computeSketchToBriefView", () => {
  it("returns setup_required when the caller has no org membership", async () => {
    const client = queueClient([{ rows: [] }]);
    const view = await computeSketchToBriefView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("fuses sketches and generated briefs into a live view", async () => {
    const client = queueClient([
      { rows: [{ orgId: ORG, teamNumber: 118 }] }, // resolveOrg
      {
        rows: [
          {
            id: "sketch-1",
            title: "Coral intake",
            notes: "Roller intake, extends 12 in past frame perimeter to grab off the floor",
            category: "intake",
            status: "brief_ready",
            seasonYear: 2026,
            createdAt: "2026-01-05T12:00:00Z",
          },
        ],
      }, // sketches
      {
        rows: [
          {
            id: "brief-1",
            sketchId: "sketch-1",
            sketchTitle: "Coral intake",
            title: "Coral intake",
            brief: {
              mechanismIntent: "Roller intake",
              category: "intake",
              sections: [],
              ruleFlags: [],
              sourceRefs: ["sketch-1"],
            },
            generatedBy: "local",
            createdAt: "2026-01-05T12:05:00Z",
          },
        ],
      }, // briefs
      { rows: [{ seasonYear: 2026 }] }, // seasons
    ]);

    const view = await computeSketchToBriefView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;

    expect(view.orgId).toBe(ORG);
    expect(view.teamNumber).toBe(118);
    expect(view.sketches).toHaveLength(1);
    expect(view.sketches[0]?.category).toBe("intake");
    expect(view.briefs).toHaveLength(1);
    expect(view.briefs[0]?.sketchId).toBe("sketch-1");
    expect(view.seasons).toContain(2026);
  });
});
