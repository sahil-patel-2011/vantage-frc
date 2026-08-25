import { describe, expect, it } from "vitest";
import { ImportShapeError } from "./result";
import {
  qrScoutColumns,
  qrScoutConfigToFormDraft,
  qrScoutPayloadsToDrafts,
  readQrScoutConfig,
} from "./qrscout";

/**
 * FIXTURE — a trimmed excerpt of the REAL published QRScout config at
 * github.com/frc2713/QRScout `config/2025/config.json`. Field objects (titles,
 * codes, types, choices, the tab delimiter) are copied verbatim from that file;
 * only most of the fields are removed to keep the fixture readable. It is a
 * form definition, not scouting data, so nothing here is invented FRC results.
 */
const QRSCOUT_2025_EXCERPT = JSON.stringify({
  title: "QRScout",
  page_title: "Reefscape",
  delimiter: "\t",
  teamNumber: 2713,
  sections: [
    {
      name: "Prematch",
      fields: [
        {
          title: "Scouter Initials",
          description: "Enter the initials of the scouter.",
          type: "text",
          required: true,
          code: "scouter",
          formResetBehavior: "preserve",
          defaultValue: "",
        },
        {
          title: "Match Number",
          type: "number",
          required: true,
          code: "matchNumber",
          formResetBehavior: "increment",
          defaultValue: 1,
        },
        {
          title: "Robot",
          type: "select",
          required: true,
          code: "robot",
          defaultValue: "R1",
          choices: { R1: "Red 1", R2: "Red 2", R3: "Red 3", B1: "Blue 1", B2: "Blue 2", B3: "Blue 3" },
        },
        {
          title: "Team Number",
          type: "number",
          required: true,
          code: "teamNumber",
          defaultValue: 0,
          min: 0,
          max: 19999,
        },
      ],
    },
    {
      name: "Autonomous",
      fields: [
        { title: "Moved?", type: "boolean", required: false, code: "Mved", defaultValue: false },
        { title: "Timer", type: "timer", required: false, code: "timer", defaultValue: 0 },
        {
          title: "Coral L1 Scored",
          type: "counter",
          required: false,
          code: "CLOA",
          defaultValue: 0,
          min: 0,
          step: 1,
        },
      ],
    },
    {
      name: "Teleop",
      fields: [
        {
          title: "Pickup Location",
          type: "select",
          required: false,
          code: "TGPL",
          defaultValue: "",
          choices: { "1": "None", "2": "Ground", "3": "Human Player", "4": "Both" },
          multiSelect: true,
        },
      ],
    },
    {
      name: "Postmatch",
      fields: [
        { title: "Offense Skill", type: "range", required: false, code: "or", defaultValue: 3, min: 1, max: 5, step: 1 },
        { title: "Comments", type: "text", required: false, code: "co", defaultValue: "", min: 0, max: 100 },
      ],
    },
  ],
});

describe("readQrScoutConfig", () => {
  it("reads the published root fields", () => {
    const config = readQrScoutConfig(QRSCOUT_2025_EXCERPT);
    expect(config.delimiter).toBe("\t");
    expect(config.teamNumber).toBe(2713);
    expect(config.sections.map((section) => section.name)).toEqual([
      "Prematch",
      "Autonomous",
      "Teleop",
      "Postmatch",
    ]);
  });

  it("rejects a file that is not a QRScout config, naming what was expected", () => {
    expect(() => readQrScoutConfig(JSON.stringify({ hello: "world" }))).toThrow(ImportShapeError);
    try {
      readQrScoutConfig(JSON.stringify({ hello: "world" }));
    } catch (error) {
      expect((error as Error).message).toContain("sections");
      expect((error as Error).message).toContain("hello");
    }
  });

  it("rejects a field with no code rather than importing a nameless column", () => {
    const broken = JSON.stringify({
      delimiter: "\t",
      sections: [{ name: "Prematch", fields: [{ title: "Scouter", type: "text" }] }],
    });
    expect(() => readQrScoutConfig(broken)).toThrow(/missing a string "code" or "type"/);
  });
});

describe("qrScoutConfigToFormDraft", () => {
  const result = qrScoutConfigToFormDraft({ content: QRSCOUT_2025_EXCERPT, sourceFile: "config.json" });
  const draft = result.drafts[0]!;
  const byKey = new Map(draft.definition.fields.map((field) => [field.key, field]));

  it("produces exactly one unpublished form draft with provenance", () => {
    expect(result.drafts).toHaveLength(1);
    expect(draft.kind).toBe("form");
    expect(draft.definition.title).toBe("Reefscape");
    expect(draft.provenance.source).toBe("qrscout");
    expect(draft.provenance.sourceFile).toBe("config.json");
  });

  it("turns section names into section_header fields", () => {
    const headers = draft.definition.fields.filter((field) => field.type === "section_header");
    expect(headers.map((field) => field.label)).toEqual(["Prematch", "Autonomous", "Teleop", "Postmatch"]);
  });

  it("maps each published QRScout type onto the Vantage union", () => {
    expect(byKey.get("scouter")?.type).toBe("short_answer");
    expect(byKey.get("matchNumber")?.type).toBe("number");
    expect(byKey.get("robot")?.type).toBe("dropdown");
    expect(byKey.get("Mved")?.type).toBe("boolean");
    expect(byKey.get("timer")?.type).toBe("timer");
    expect(byKey.get("CLOA")?.type).toBe("counter");
    expect(byKey.get("or")?.type).toBe("slider");
  });

  it("honours the legacy multiSelect flag on a select", () => {
    expect(byKey.get("TGPL")?.type).toBe("multi_select");
  });

  it("keeps the stored choice values, not the display labels", () => {
    expect(byKey.get("robot")?.options).toEqual(["R1", "R2", "R3", "B1", "B2", "B3"]);
  });

  it("does not import TBA-team-and-robot as a question, and says why", () => {
    const withIdentity = qrScoutConfigToFormDraft({
      content: JSON.stringify({
        delimiter: "\t",
        sections: [
          {
            name: "Prematch",
            fields: [
              { title: "Team", type: "TBA-team-and-robot", required: true, code: "team" },
              { title: "Auto Notes", type: "text", required: false, code: "notes" },
            ],
          },
        ],
      }),
    });
    const keys = withIdentity.drafts[0]!.definition.fields.map((field) => field.key);
    expect(keys).not.toContain("team");
    expect(withIdentity.skipped.some((skip) => /identity outside the form/.test(skip.reason))).toBe(true);
  });

  it("falls back to the closest type for action-tracker and records the loss", () => {
    const withTracker = qrScoutConfigToFormDraft({
      content: JSON.stringify({
        delimiter: "\t",
        sections: [
          {
            name: "Teleop",
            fields: [
              {
                title: "Cycles",
                type: "action-tracker",
                required: false,
                code: "cyc",
                actions: [
                  { code: "pickup", title: "Pickup" },
                  { code: "score", title: "Score" },
                ],
              },
            ],
          },
        ],
      }),
    });
    const field = withTracker.drafts[0]!.definition.fields.find((item) => item.key === "cyc");
    expect(field?.type).toBe("multi_counter");
    expect(field?.config?.subCounters).toEqual([
      { key: "pickup", label: "Pickup" },
      { key: "score", label: "Score" },
    ]);
    expect(withTracker.skipped.some((skip) => /timestamps it records are not carried over/.test(skip.reason))).toBe(
      true,
    );
  });
});

describe("qrScoutColumns", () => {
  it("emits one column per field, in section then field order", () => {
    const config = readQrScoutConfig(QRSCOUT_2025_EXCERPT);
    expect(qrScoutColumns(config).map((column) => column.code)).toEqual([
      "scouter",
      "matchNumber",
      "robot",
      "teamNumber",
      "Mved",
      "timer",
      "CLOA",
      "TGPL",
      "or",
      "co",
    ]);
  });

  it("expands action-tracker into the _count/_times pair QRScout writes", () => {
    const config = readQrScoutConfig(
      JSON.stringify({
        delimiter: "\t",
        sections: [
          {
            name: "Teleop",
            fields: [
              { title: "Team", type: "number", required: true, code: "teamNumber" },
              {
                title: "Cycles",
                type: "action-tracker",
                required: false,
                code: "cyc",
                actions: [{ code: "pickup", title: "Pickup" }],
              },
            ],
          },
        ],
      }),
    );
    expect(qrScoutColumns(config).map((column) => column.code)).toEqual([
      "teamNumber",
      "cyc_pickup_count",
      "cyc_pickup_times",
    ]);
  });
});

describe("qrScoutPayloadsToDrafts", () => {
  // Tab-delimited payload lines in the column order the config above defines.
  const line = (values: string[]) => values.join("\t");
  const payloads = [
    line(["AB", "12", "R1", "254", "true", "4.2", "3", "2,3", "4", "Strong cycles"]),
    line(["CD", "12", "B2", "1678", "false", "0", "1", "", "2", ""]),
  ].join("\n");

  const result = qrScoutPayloadsToDrafts({
    configContent: QRSCOUT_2025_EXCERPT,
    payloadContent: payloads,
    eventKey: "2025mokc",
    now: new Date("2025-03-01T00:00:00.000Z"),
  });

  it("reads identity from the config's team and match columns", () => {
    expect(result.drafts.map((draft) => draft.teamKey)).toEqual(["frc254", "frc1678"]);
    expect(result.drafts.map((draft) => draft.matchKey)).toEqual(["2025mokc_qm12", "2025mokc_qm12"]);
    expect(result.errors).toEqual([]);
  });

  it("coerces each column by its declared QRScout type", () => {
    const payload = result.drafts[0]!.payload;
    expect(payload.Mved).toBe(true);
    expect(payload.timer).toBe(4.2);
    expect(payload.CLOA).toBe(3);
    expect(payload.or).toBe(4);
    expect(payload.co).toBe("Strong cycles");
    // A `select` carrying multiSelect stores its values comma-joined.
    expect(payload.TGPL).toEqual(["2", "3"]);
  });

  it("leaves the identity columns out of the payload", () => {
    expect(result.drafts[0]!.payload).not.toHaveProperty("teamNumber");
    expect(result.drafts[0]!.payload).not.toHaveProperty("matchNumber");
  });

  it("is idempotent — re-importing the same lines yields the same keys", () => {
    const again = qrScoutPayloadsToDrafts({
      configContent: QRSCOUT_2025_EXCERPT,
      payloadContent: payloads,
      eventKey: "2025mokc",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(again.drafts.map((draft) => draft.idempotencyKey)).toEqual(
      result.drafts.map((draft) => draft.idempotencyKey),
    );
  });

  it("skips a repeated identical scan rather than double-counting it", () => {
    const doubled = qrScoutPayloadsToDrafts({
      configContent: QRSCOUT_2025_EXCERPT,
      payloadContent: [payloads.split("\n")[0]!, payloads.split("\n")[0]!].join("\n"),
      eventKey: "2025mokc",
    });
    expect(doubled.drafts).toHaveLength(1);
    expect(doubled.skipped[0]?.reason).toMatch(/duplicate/);
  });

  it("rejects a line whose column count does not match the config", () => {
    const shifted = qrScoutPayloadsToDrafts({
      configContent: QRSCOUT_2025_EXCERPT,
      payloadContent: line(["AB", "12", "R1", "254"]),
      eventKey: "2025mokc",
    });
    expect(shifted.drafts).toHaveLength(0);
    expect(shifted.errors[0]?.message).toMatch(/4 values but the config defines 10 columns/);
  });

  it("refuses to import without an event key", () => {
    const noEvent = qrScoutPayloadsToDrafts({
      configContent: QRSCOUT_2025_EXCERPT,
      payloadContent: payloads,
      eventKey: "  ",
    });
    expect(noEvent.drafts).toHaveLength(0);
    expect(noEvent.errors[0]?.message).toMatch(/Pick the event/);
  });
});
