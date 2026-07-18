import { describe, expect, it, vi } from "vitest";
import { computeMatchNotesTimelineView } from "./compute-match-notes-timeline";

type QueryCall = { text: string; values: unknown[] };

function makeClient(responses: Array<{ rows: unknown[] }>) {
  const calls: QueryCall[] = [];
  let index = 0;
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return response;
    }),
  };
  return { client: client as unknown as import("@neondatabase/serverless").PoolClient, calls };
}

describe("computeMatchNotesTimelineView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeClient([{ rows: [] }]);

    const view = await computeMatchNotesTimelineView(client, { userId: "user-1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("groups mock entries into per-match timelines and a summary", async () => {
    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          {
            id: "note-1",
            matchLabel: "Qualification 12",
            matchKey: "2026miket_qm12",
            teamNumber: 254,
            seasonYear: 2026,
            phase: "auto",
            category: "observation",
            clockSeconds: 5,
            note: "Fast auto cycle, scored preload immediately.",
            createdAt: "2026-03-01T10:00:00.000Z",
          },
          {
            id: "note-2",
            matchLabel: "Qualification 12",
            matchKey: "2026miket_qm12",
            teamNumber: 254,
            seasonYear: 2026,
            phase: "teleop",
            category: "issue",
            clockSeconds: 90,
            note: "Intake jammed, lost ~10 seconds recovering.",
            createdAt: "2026-03-01T10:02:00.000Z",
          },
          {
            id: "note-3",
            matchLabel: "Qualification 11",
            matchKey: "2026miket_qm11",
            teamNumber: 254,
            seasonYear: 2026,
            phase: "endgame",
            category: "highlight",
            clockSeconds: 140,
            note: "Clean climb with 3 seconds to spare.",
            createdAt: "2026-03-01T09:40:00.000Z",
          },
        ],
      },
      { rows: [{ seasonYear: 2026 }] },
    ]);

    const view = await computeMatchNotesTimelineView(client, { userId: "user-1", requestedOrg: "org-1" });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.timelines).toHaveLength(2);

    const qm12 = view.timelines.find((t) => t.matchLabel === "Qualification 12");
    expect(qm12?.entries.map((e) => e.id)).toEqual(["note-1", "note-2"]);
    expect(qm12?.entryCount).toBe(2);

    expect(view.summary.totalEntries).toBe(3);
    expect(view.summary.totalMatches).toBe(2);
    expect(view.summary.byCategory.find((c) => c.category === "issue")?.count).toBe(1);
    expect(view.summary.byPhase.find((p) => p.phase === "endgame")?.count).toBe(1);
  });
});
