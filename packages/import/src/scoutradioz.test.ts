import { describe, expect, it } from "vitest";
import { ImportShapeError } from "./result";
import { readScoutradiozDocuments, scoutradiozToDrafts } from "./scoutradioz";

/**
 * FIXTURE — documents shaped exactly like the `matchscouting` collection
 * declared in Scoutradioz's own `scoutradioz-types/types.d.ts` (year,
 * event_key, org_key, match_key, match_number, time, alliance, team_key,
 * match_team_key, data). Team numbers and metric values are illustrative
 * placeholders for the shape, NOT real competition results.
 */
const MATCH_DOCUMENTS = JSON.stringify([
  {
    year: 2025,
    event_key: "2025mokc",
    org_key: "demoteam",
    match_key: "2025mokc_qm1",
    match_number: 1,
    time: 1740000000,
    alliance: "red",
    team_key: "frc9991",
    match_team_key: "2025mokc_qm1_frc9991",
    data: { autoCoral: 2, teleCoral: 5, climb: "deep", contributedToWin: true, sectionHeaderAuto: "" },
  },
  {
    year: 2025,
    event_key: "2025mokc",
    org_key: "demoteam",
    match_key: "2025mokc_qm1",
    match_number: 1,
    time: 1740000000,
    alliance: "blue",
    team_key: "frc9992",
    match_team_key: "2025mokc_qm1_frc9992",
    data: { autoCoral: 0, teleCoral: 3, climb: "none", contributedToWin: false },
  },
  {
    // Assigned but never scouted — Scoutradioz's own export filters these out.
    year: 2025,
    event_key: "2025mokc",
    org_key: "demoteam",
    match_key: "2025mokc_qm2",
    match_number: 2,
    alliance: "red",
    team_key: "frc9993",
    match_team_key: "2025mokc_qm2_frc9993",
  },
]);

/** Layout shaped like Scoutradioz `SchemaItem`s (scoutradioz-helpers/jsonlayout.ts). */
const LAYOUT = [
  { type: "header", label: "Autonomous" },
  { type: "counter", id: "autoCoral", label: "Auto Coral" },
  { type: "spacer" },
  { type: "counter", id: "teleCoral", label: "Teleop Coral" },
  { type: "derived", id: "totalCoral", formula: "autoCoral + teleCoral" },
  { type: "textblock", id: "sectionHeaderAuto", label: "Read this first" },
];

describe("readScoutradiozDocuments", () => {
  it("accepts a bare array of documents", () => {
    expect(readScoutradiozDocuments(MATCH_DOCUMENTS)).toHaveLength(3);
  });

  it("accepts the common wrapper shapes", () => {
    const wrapped = JSON.stringify({ matchscouting: JSON.parse(MATCH_DOCUMENTS) });
    expect(readScoutradiozDocuments(wrapped)).toHaveLength(3);
  });

  it("rejects unrelated JSON, naming what was expected", () => {
    expect(() => readScoutradiozDocuments(JSON.stringify({ teams: [] }))).toThrow(ImportShapeError);
    try {
      readScoutradiozDocuments(JSON.stringify({ teams: [] }));
    } catch (error) {
      expect((error as Error).message).toContain("matchscouting");
      expect((error as Error).message).toContain("teams");
    }
  });
});

/** The CSV shape Scoutradioz's live /reports/exportdata route emits today. */
const MATCH_CSV = [
  "year,event_key,org_key,match_key,match_number,alliance,team_key,match_team_key,autoCoral,teleCoral,climb",
  "2025,2025mokc,demoteam,2025mokc_qm1,1,red,frc9991,2025mokc_qm1_frc9991,2,5,deep",
  "2025,2025mokc,demoteam,2025mokc_qm1,1,blue,frc9992,2025mokc_qm1_frc9992,0,3,none",
].join("\n");

const PIT_CSV = [
  "year,event_key,org_key,team_key,drivetrain,weight",
  "2025,2025mokc,demoteam,frc9991,swerve,118",
].join("\n");

describe("readScoutradiozDocuments (CSV)", () => {
  it("reads the live CSV export, lifting identity columns and keeping answers under their own headers", () => {
    const documents = readScoutradiozDocuments(MATCH_CSV);
    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({
      year: 2025,
      event_key: "2025mokc",
      match_key: "2025mokc_qm1",
      match_number: 1,
      alliance: "red",
      team_key: "frc9991",
      match_team_key: "2025mokc_qm1_frc9991",
    });
    // Answers pass through under their literal headers — never renamed or guessed.
    expect(documents[0]!.data).toEqual({ autoCoral: "2", teleCoral: "5", climb: "deep" });
  });

  it("rejects a CSV with no team_key column, naming the headers it saw", () => {
    const wrong = "team,auto,tele\n9991,2,5";
    expect(() => readScoutradiozDocuments(wrong)).toThrow(ImportShapeError);
    try {
      readScoutradiozDocuments(wrong);
    } catch (error) {
      expect((error as Error).message).toContain("team, auto, tele");
      expect((error as Error).message).toContain("matchscouting");
    }
  });
});

describe("scoutradiozToDrafts (CSV)", () => {
  it("imports a CSV match row end to end", () => {
    const result = scoutradiozToDrafts({ content: MATCH_CSV, now: new Date("2025-03-01T00:00:00.000Z") });
    expect(result.drafts.map((draft) => draft.teamKey)).toEqual(["frc9991", "frc9992"]);
    expect(result.drafts[0]!.entryType).toBe("match");
    expect(result.drafts[0]!.idempotencyKey).toBe("scoutradioz:2025mokc_qm1_frc9991");
    expect(result.drafts[0]!.payload).toEqual({ autoCoral: "2", teleCoral: "5", climb: "deep" });
  });

  it("imports a CSV pit row (no match_key column)", () => {
    const result = scoutradiozToDrafts({ content: PIT_CSV });
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]!.entryType).toBe("pit");
    expect(result.drafts[0]!.idempotencyKey).toBe("scoutradioz:2025mokc_frc9991");
    expect(result.drafts[0]!.payload).toEqual({ drivetrain: "swerve", weight: "118" });
  });
});

describe("scoutradiozToDrafts", () => {
  const result = scoutradiozToDrafts({
    content: MATCH_DOCUMENTS,
    layout: LAYOUT,
    sourceFile: "matchscouting_demoteam_2025mokc.json",
    now: new Date("2025-03-01T00:00:00.000Z"),
  });

  it("imports only the scouted rows", () => {
    expect(result.drafts.map((draft) => draft.teamKey)).toEqual(["frc9991", "frc9992"]);
  });

  it("skips an assigned-but-unscouted row with a reason", () => {
    expect(
      result.skipped.some((skip) => skip.ref === "2025mokc_qm2_frc9993" && /never scouted/.test(skip.reason)),
    ).toBe(true);
  });

  it("carries the Scoutradioz identity through as the idempotency key", () => {
    expect(result.drafts[0]!.idempotencyKey).toBe("scoutradioz:2025mokc_qm1_frc9991");
    expect(result.drafts[0]!.eventKey).toBe("2025mokc");
    expect(result.drafts[0]!.matchKey).toBe("2025mokc_qm1");
    expect(result.drafts[0]!.provenance.source).toBe("scoutradioz");
  });

  it("drops derived metrics and layout-only elements, each with a reason", () => {
    expect(result.drafts[0]!.payload).not.toHaveProperty("totalCoral");
    expect(result.drafts[0]!.payload).not.toHaveProperty("sectionHeaderAuto");
    const reasons = result.skipped.map((skip) => skip.reason).join(" | ");
    expect(reasons).toMatch(/"derived" metric is a formula/);
    expect(reasons).toMatch(/"textblock" is static instruction text/);
    expect(reasons).toMatch(/"header" is a layout heading/);
    expect(reasons).toMatch(/"spacer" is layout whitespace/);
  });

  it("keeps the real scouted answers", () => {
    expect(result.drafts[0]!.payload).toEqual({
      autoCoral: 2,
      teleCoral: 5,
      climb: "deep",
      contributedToWin: true,
    });
  });

  it("is idempotent — a second import produces the same keys", () => {
    const again = scoutradiozToDrafts({ content: MATCH_DOCUMENTS, layout: LAYOUT, now: new Date("2026-01-01") });
    expect(again.drafts.map((draft) => draft.idempotencyKey)).toEqual(
      result.drafts.map((draft) => draft.idempotencyKey),
    );
  });

  it("treats a document with no match_key as a pit row", () => {
    const pit = scoutradiozToDrafts({
      content: JSON.stringify([
        {
          year: 2025,
          event_key: "2025mokc",
          org_key: "demoteam",
          team_key: "frc9991",
          data: { drivetrain: "swerve", weight: 118 },
        },
      ]),
    });
    expect(pit.drafts[0]!.entryType).toBe("pit");
    expect(pit.drafts[0]!.matchKey).toBeUndefined();
    expect(pit.drafts[0]!.idempotencyKey).toBe("scoutradioz:2025mokc_frc9991");
  });

  it("skips rows for a different event when one is selected", () => {
    const filtered = scoutradiozToDrafts({ content: MATCH_DOCUMENTS, eventKey: "2025txhou" });
    expect(filtered.drafts).toHaveLength(0);
    expect(filtered.skipped.some((skip) => /not the selected event 2025txhou/.test(skip.reason))).toBe(true);
  });

  it("skips a row whose team_key is not in frcNNNN form", () => {
    const bad = scoutradiozToDrafts({
      content: JSON.stringify([{ event_key: "2025mokc", team_key: "9991", data: { autoCoral: 1 } }]),
    });
    expect(bad.drafts).toHaveLength(0);
    expect(bad.skipped[0]?.reason).toMatch(/frcNNNN/);
  });
});
