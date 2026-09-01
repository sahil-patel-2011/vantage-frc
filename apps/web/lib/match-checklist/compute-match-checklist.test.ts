import { describe, expect, it, vi } from "vitest";
import { computeMatchChecklistView, startChecklistRun } from "./compute-match-checklist";

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

describe("computeMatchChecklistView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeClient([{ rows: [] }]);

    const view = await computeMatchChecklistView(client, { userId: "user-1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.steps.map((s) => s.id)).toContain("workspace");
      expect(view.message.toLowerCase()).not.toContain("demo");
    }
  });

  it("computes a live summary with elapsed time and readiness from mock runs", async () => {
    const now = new Date();
    const startedOpen = new Date(now.getTime() - 45 * 1000).toISOString();
    const startedDone = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const completedDone = new Date(now.getTime() - 9 * 60 * 1000).toISOString();

    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          {
            id: "run-open",
            matchLabel: "Qualification 12",
            eventKey: "2026miket",
            teamNumber: 254,
            startedAt: startedOpen,
            completedAt: null,
            items: [
              { key: "bumper", label: "Bumpers secured", done: true, checkedAt: startedOpen },
              { key: "battery", label: "Battery charged & seated", done: false, checkedAt: null },
              { key: "tether", label: "Tether / e-stop clipped", done: false, checkedAt: null },
              { key: "code", label: "Code deployed & radio linked", done: false, checkedAt: null },
            ],
          },
          {
            id: "run-done",
            matchLabel: "Qualification 11",
            eventKey: "2026miket",
            teamNumber: 254,
            startedAt: startedDone,
            completedAt: completedDone,
            items: [
              { key: "bumper", label: "Bumpers secured", done: true, checkedAt: startedDone },
              { key: "battery", label: "Battery charged & seated", done: true, checkedAt: startedDone },
              { key: "tether", label: "Tether / e-stop clipped", done: true, checkedAt: startedDone },
              { key: "code", label: "Code deployed & radio linked", done: true, checkedAt: completedDone },
            ],
          },
        ],
      },
      { rows: [{ activeEventKey: "2026miket" }] },
      { rows: [] },
    ]);

    const view = await computeMatchChecklistView(client, { userId: "user-1", requestedOrg: "org-1" });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.runs).toHaveLength(2);

    const open = view.runs.find((r) => r.id === "run-open");
    expect(open?.allDone).toBe(false);
    expect(open?.completedAt).toBeNull();
    expect(open?.elapsedSeconds).toBeGreaterThanOrEqual(40);

    const done = view.runs.find((r) => r.id === "run-done");
    expect(done?.allDone).toBe(true);
    expect(done?.elapsedSeconds).toBe(60);

    expect(view.summary.totalRuns).toBe(2);
    expect(view.summary.completedRuns).toBe(1);
    expect(view.summary.openRuns).toBe(1);
    expect(view.summary.averageElapsedSeconds).toBe(60);
    expect(view.summary.fastestElapsedSeconds).toBe(60);
    expect(open?.bumperColor).toBeNull();
    expect(view.upcomingMatches).toEqual([]);
  });

  it("overlays TBA bumper color when the team is on a cached alliance list", async () => {
    const started = "2026-03-21T15:00:00.000Z";
    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          {
            id: "run-q12",
            matchLabel: "Qualification 12",
            eventKey: "2026miket",
            teamNumber: 254,
            startedAt: started,
            completedAt: null,
            items: [
              { key: "bumper", label: "Bumpers secured", done: false, checkedAt: null },
              { key: "battery", label: "Battery charged & seated", done: false, checkedAt: null },
              { key: "tether", label: "Tether / e-stop clipped", done: false, checkedAt: null },
              { key: "code", label: "Code deployed & radio linked", done: false, checkedAt: null },
            ],
          },
        ],
      },
      { rows: [{ activeEventKey: "2026miket" }] },
      {
        rows: [
          {
            matchKey: "2026miket_qm12",
            eventKey: "2026miket",
            compLevel: "qm",
            matchNumber: 12,
            predictedTime: "2026-03-21T16:00:00.000Z",
            actualTime: null,
            redAlliance: { teamKeys: ["frc118", "frc254", "frc1114"] },
            blueAlliance: { teamKeys: ["frc33", "frc67", "frc2056"] },
          },
        ],
      },
    ]);

    const view = await computeMatchChecklistView(client, { userId: "user-1", requestedOrg: "org-1" });
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.runs[0]?.bumperColor).toBe("red");
    expect(view.runs[0]?.items.find((item) => item.key === "bumper")?.label).toBe("RED bumpers secured");
    expect(view.upcomingMatches).toEqual([
      { matchKey: "2026miket_qm12", eventKey: "2026miket", label: "Qual 12", bumperColor: "red" },
    ]);
  });

  it("keeps unmapped SOP keys when reading a stored run — they do not vanish", async () => {
    const started = "2026-03-21T15:00:00.000Z";
    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          {
            id: "run-sop",
            matchLabel: "Qual 12",
            eventKey: "2026miket",
            teamNumber: 254,
            startedAt: started,
            completedAt: null,
            items: [
              { key: "bumper", label: "Bumpers on", done: false, checkedAt: null, sourceSopKey: "bumper" },
              { key: "tote", label: "Totes loaded", done: false, checkedAt: null, sourceSopKey: "tote" },
            ],
          },
        ],
      },
      { rows: [{ activeEventKey: "2026miket" }] },
      { rows: [] },
    ]);

    const view = await computeMatchChecklistView(client, { userId: "user-1", requestedOrg: "org-1" });
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.runs[0]?.items.map((item) => item.key)).toEqual(["bumper", "tote"]);
    expect(view.runs[0]?.items.find((item) => item.key === "tote")?.label).toBe("Totes loaded");
    expect(JSON.stringify(view.runs[0]?.items).toLowerCase()).not.toContain("demo");
  });
});

describe("startChecklistRun", () => {
  it("instantiates from the active pit SOP and stores unmapped steps as custom items", async () => {
    const { client, calls } = makeClient([
      {
        rows: [
          {
            id: "tmpl-1",
            name: "Pre-queue SOP",
            items: [
              { key: "bumper", label: "Bumpers on" },
              { key: "tote", label: "Totes loaded" },
            ],
          },
        ],
      },
      { rows: [] },
    ]);

    await startChecklistRun(client, {
      orgId: "org-1",
      userId: "user-1",
      matchLabel: "Qual 12",
      eventKey: "2026miket",
      teamNumber: 254,
    });

    const insert = calls.find((call) => call.text.includes("INSERT INTO match_checklist_runs"));
    expect(insert).toBeDefined();
    const items = JSON.parse(String(insert?.values[4])) as Array<{ key: string; label: string }>;
    expect(items.map((item) => item.key)).toEqual(["bumper", "tote"]);
    expect(items.find((item) => item.key === "tote")?.label).toBe("Totes loaded");
    expect(JSON.stringify(items).toLowerCase()).not.toContain("demo");
    expect(items.some((item) => item.key === "sb50")).toBe(false);
  });

  it("falls back to default pit cues when no SOP exists — still never DEMO", async () => {
    const { client, calls } = makeClient([{ rows: [] }, { rows: [] }]);

    await startChecklistRun(client, {
      orgId: "org-1",
      userId: "user-1",
      matchLabel: "Qual 12",
      eventKey: null,
      teamNumber: 254,
    });

    const insert = calls.find((call) => call.text.includes("INSERT INTO match_checklist_runs"));
    const items = JSON.parse(String(insert?.values[4])) as Array<{ key: string; label: string }>;
    expect(items.map((item) => item.key)).toContain("bumper");
    expect(items.every((item) => !/demo/i.test(`${item.key} ${item.label}`))).toBe(true);
  });
});
