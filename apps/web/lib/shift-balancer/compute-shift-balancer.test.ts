import { describe, expect, it, vi } from "vitest";
import { computeShiftBalancerView } from "./compute-shift-balancer";
import { generateRotation, overlayScheduleOnRotation, planToCsv, scheduleSlotsFromQuals, summarizePlan, tabletSheetsByScout } from ".";

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

describe("computeShiftBalancerView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeClient([{ rows: [] }]);

    const view = await computeShiftBalancerView(client, { userId: "user-1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("computes a live view with plan summary from mock rows", async () => {
    const now = new Date().toISOString();
    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          { id: "scout-a", name: "Ada", active: true },
          { id: "scout-b", name: "Bo", active: true },
          { id: "scout-c", name: "Cy", active: true },
        ],
      },
      {
        rows: [
          {
            id: "plan-1",
            label: "Qual rotation",
            matchCount: 2,
            stations: ["Red 1", "Blue 1"],
            maxConsecutiveMatches: 1,
            assignments: [
              { match: 1, station: "Red 1", scoutId: "scout-a", scoutName: "Ada" },
              { match: 1, station: "Blue 1", scoutId: "scout-b", scoutName: "Bo" },
              { match: 2, station: "Red 1", scoutId: "scout-c", scoutName: "Cy" },
              { match: 2, station: "Blue 1", scoutId: "scout-a", scoutName: "Ada" },
            ],
            createdAt: now,
          },
        ],
      },
      { rows: [{ eventKey: "2026casj" }] },
      { rows: [{ qualCount: 12 }] },
    ]);

    const view = await computeShiftBalancerView(client, { userId: "user-1", requestedOrg: "org-1" });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.scouts).toHaveLength(3);
    expect(view.plans).toHaveLength(1);
    expect(view.latestSummary).not.toBeNull();
    expect(view.latestSummary?.totalShifts).toBe(4);
    expect(view.latestSummary?.scoutsUsed).toBe(3);
    expect(view.eventKey).toBe("2026casj");
    expect(view.qualMatchCount).toBe(12);
  });
});

describe("generateRotation", () => {
  it("caps consecutive matches per scout while filling every station", () => {
    const scouts = [
      { id: "a", name: "Ada", active: true },
      { id: "b", name: "Bo", active: true },
    ];
    const assignments = generateRotation({
      scouts,
      matchCount: 6,
      stations: ["Red 1"],
      maxConsecutiveMatches: 2,
    });

    expect(assignments).toHaveLength(6);

    // No scout should ever work 3 matches in a row.
    let streak = 0;
    let lastScout: string | null = null;
    for (const a of assignments) {
      if (a.scoutId === lastScout) {
        streak += 1;
      } else {
        streak = 1;
        lastScout = a.scoutId;
      }
      expect(streak).toBeLessThanOrEqual(2);
    }
  });

  it("returns an empty rotation for an empty roster", () => {
    expect(generateRotation({ scouts: [], matchCount: 5, stations: ["Red 1"], maxConsecutiveMatches: 2 })).toEqual(
      [],
    );
  });
});

describe("scheduleSlotsFromQuals", () => {
  it("flattens TBA alliances into Red/Blue stations and skips empty keys", () => {
    const slots = scheduleSlotsFromQuals([
      {
        matchKey: "2026casj_qm2",
        matchNumber: 2,
        redAlliance: { teamKeys: ["frc254", "frc1678", "frc973"] },
        blueAlliance: { teamKeys: ["frc118"] },
      },
      {
        matchKey: "2026casj_qm1",
        matchNumber: 1,
        redAlliance: { teamKeys: ["frc1", "frc2", "frc3"] },
        blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] },
      },
    ]);
    expect(slots[0]).toMatchObject({ matchKey: "2026casj_qm1", station: "Red 1", teamNumber: 1 });
    expect(slots.filter((slot) => slot.matchNumber === 2)).toHaveLength(4);
  });
});

describe("overlayScheduleOnRotation", () => {
  it("attaches TBA match keys and team numbers onto a fatigue rotation", () => {
    const rotation = generateRotation({
      scouts: [
        { id: "a", name: "Ada", active: true },
        { id: "b", name: "Bo", active: true },
      ],
      matchCount: 2,
      stations: ["Red 1", "Blue 1"],
      maxConsecutiveMatches: 2,
    });
    const overlaid = overlayScheduleOnRotation(rotation, [
      { matchKey: "2026casj_qm10", matchNumber: 10, station: "Red 1", teamKey: "frc254", teamNumber: 254 },
      { matchKey: "2026casj_qm10", matchNumber: 10, station: "Blue 1", teamKey: "frc1678", teamNumber: 1678 },
      { matchKey: "2026casj_qm12", matchNumber: 12, station: "Red 1", teamKey: "frc973", teamNumber: 973 },
      { matchKey: "2026casj_qm12", matchNumber: 12, station: "Blue 1", teamKey: "frc118", teamNumber: 118 },
    ]);
    expect(overlaid[0]).toMatchObject({ matchLabel: "QM 10", teamNumber: 254, matchKey: "2026casj_qm10" });
    expect(overlaid.find((row) => row.match === 2 && row.station === "Blue 1")).toMatchObject({
      matchLabel: "QM 12",
      teamNumber: 118,
    });
  });

  it("flags a natural break when TBA times have a lunch-sized gap", () => {
    const rotation = generateRotation({
      scouts: [{ id: "a", name: "Ada", active: true }],
      matchCount: 2,
      stations: ["Red 1"],
      maxConsecutiveMatches: 2,
    });
    const overlaid = overlayScheduleOnRotation(rotation, [
      {
        matchKey: "2026casj_qm1",
        matchNumber: 1,
        station: "Red 1",
        teamKey: "frc254",
        teamNumber: 254,
        scheduledAt: "2026-03-07T11:00:00.000Z",
      },
      {
        matchKey: "2026casj_qm2",
        matchNumber: 2,
        station: "Red 1",
        teamKey: "frc1678",
        teamNumber: 1678,
        scheduledAt: "2026-03-07T12:00:00.000Z",
      },
    ]);
    expect(overlaid[0]?.breakAfterMinutes).toBe(60);
    expect(overlaid[1]?.breakAfterMinutes).toBeUndefined();
  });

  it("leaves numeric assignments unchanged when the schedule cache is empty", () => {
    const rotation = generateRotation({
      scouts: [{ id: "a", name: "Ada", active: true }],
      matchCount: 1,
      stations: ["Red 1"],
      maxConsecutiveMatches: 1,
    });
    expect(overlayScheduleOnRotation(rotation, [])).toEqual(rotation);
  });
});

describe("planToCsv and tablet sheets", () => {
  it("exports one CSV row per assignment and groups a sheet per scout", () => {
    const assignments = [
      { match: 1, station: "Red 1", scoutId: "a", scoutName: "Ada", matchLabel: "QM 1", teamNumber: 254 },
      { match: 1, station: "Blue 1", scoutId: "b", scoutName: "Bo", matchLabel: "QM 1", teamNumber: 118 },
      { match: 2, station: "Red 1", scoutId: "a", scoutName: "Ada", matchLabel: "QM 2", teamNumber: 973 },
    ];
    const csv = planToCsv({ label: "Quals", assignments });
    expect(csv).toContain("Plan,Match,Match key,Station,Team,Scout,Scheduled,Break after (min)");
    expect(csv).toContain("Quals,QM 1,,Red 1,254,Ada,,");
    expect(csv.split("\n").filter(Boolean)).toHaveLength(4);
    const sheets = tabletSheetsByScout(assignments);
    expect(sheets.map((sheet) => sheet.scoutName)).toEqual(["Ada", "Bo"]);
    expect(sheets[0]?.rows).toHaveLength(2);
  });
});

describe("summarizePlan", () => {
  it("flags a roster shortfall when active scouts are fewer than stations", () => {
    const scouts = [{ id: "a", name: "Ada", active: true }];
    const summary = summarizePlan({
      scouts,
      matchCount: 1,
      stations: ["Red 1", "Blue 1"],
      assignments: [{ match: 1, station: "Red 1", scoutId: "a", scoutName: "Ada" }],
    });
    expect(summary.rosterShortfall).toBe(true);
    expect(summary.totalShifts).toBe(1);
  });
});
