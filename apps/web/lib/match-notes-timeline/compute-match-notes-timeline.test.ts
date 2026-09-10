import { describe, expect, it, vi } from "vitest";
import { computeMatchNotesTimelineView } from "./compute-match-notes-timeline";
import { actionTrackerStrip, parseActionRanges } from ".";
import { expectPlainCopy } from "../ui/copy-assertions";

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
      expect(view.steps.map((s) => s.id)).toEqual(["workspace", "schedule", "strategy", "scouting"]);
      expect(view.steps[0]?.href).toBe("/workspace");
      expect(view.steps.find((s) => s.id === "schedule")?.href).toBe("/schedule");
      expect(view.steps.find((s) => s.id === "strategy")?.href).toBe("/competition?tab=strategy");
      expect(view.steps.find((s) => s.id === "scouting")?.href).toBe("/competition?tab=scouting");
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
      view.steps.forEach((s) => expectPlainCopy(s.detail));
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
      { rows: [] },
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

  it("places confirmed video events on the same match timeline, labeled as from video", async () => {
    const { client, calls } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 6925 }] },
      {
        rows: [
          {
            id: "note-1",
            matchLabel: "Qualification 3",
            matchKey: "2026miket_qm3",
            teamNumber: 6925,
            seasonYear: 2026,
            phase: "auto",
            category: "observation",
            clockSeconds: 4,
            note: "Preload scored.",
            createdAt: "2026-03-01T10:00:00.000Z",
          },
        ],
      },
      { rows: [{ seasonYear: 2026 }] },
      {
        rows: [
          {
            id: "job-1",
            matchKey: "2026miket_qm3",
            createdAt: "2026-03-01T10:05:00.000Z",
            result: {
              events: [
                { tSec: 8, kind: "score", label: "auto speaker", confidence: 0.7 },
                { kind: "score", label: "missing clock" },
              ],
            },
          },
        ],
      },
    ]);

    const view = await computeMatchNotesTimelineView(client, { userId: "user-1", requestedOrg: "org-1" });
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    expect(calls.some((call) => call.text.includes("video_analysis_jobs"))).toBe(true);
    const timeline = view.timelines.find((t) => t.matchLabel === "Qualification 3");
    expect(timeline?.entries).toHaveLength(2);
    const video = timeline?.entries.find((e) => e.source === "video");
    expect(video?.note).toContain("from video (confidence 0.7)");
    expect(video?.clockSeconds).toBe(8);
    expect(timeline?.entries.every((e) => e.matchLabel === "Qualification 3")).toBe(true);
  });
});

describe("QRScout action tracker", () => {
  it("parses hold ranges and paints a 1D strip without inventing actions", () => {
    expect(parseActionRanges("12-18,22-30")).toEqual([
      { start: 12, end: 18 },
      { start: 22, end: 30 },
    ]);
    expect(parseActionRanges("not a range")).toEqual([]);
    const strip = actionTrackerStrip(
      [
        { start: 12, end: 18, code: "s" },
        { start: 0, end: 4, code: "c" },
      ],
      20,
      5,
    );
    expect(strip).toEqual(["c", "", "s", "s"]);
  });
});
