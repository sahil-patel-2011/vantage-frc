import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH_SCHEMA, DEFAULT_PIT_SCHEMA, type SchemaDefinition } from "@vantage/scouting";
import { CSV_BOM, CSV_EOL } from "../export/to-csv";
import {
  EVENT_ANSWER_IDENTITY_COLUMNS,
  eventAnswerColumns,
  eventAnswersCsv,
  type EventAnswerRow,
} from "./event-answers-csv";

const matchSchema: SchemaDefinition = {
  title: "Match",
  fields: [
    { key: "auto", label: "Auto", type: "number" },
    { key: "section", label: "Teleop", type: "section_header" },
    {
      key: "cycles",
      label: "Cycles",
      type: "multi_counter",
      config: { counters: [{ key: "speaker", label: "Speaker" }, { key: "amp", label: "Amp" }] },
    },
    { key: "notes", label: "Notes", type: "text" },
  ],
};

const pitSchema: SchemaDefinition = {
  title: "Pit",
  fields: [
    { key: "drivetrain_type", label: "Drivetrain", type: "drivetrain_type" },
    { key: "notes", label: "Notes", type: "text" },
  ],
};

function row(partial: Partial<EventAnswerRow> & Pick<EventAnswerRow, "type" | "teamKey">): EventAnswerRow {
  return {
    eventKey: "2026test",
    matchKey: partial.type === "match" ? "2026test_qm1" : null,
    scoutName: "Alex",
    source: "manual",
    confidence: "normal",
    updatedAt: "2026-03-15T18:00:00.000Z",
    payload: {},
    ...partial,
  };
}

function lines(csv: string): string[] {
  return csv.replace(CSV_BOM, "").split(CSV_EOL).filter((line) => line.length > 0);
}

describe("eventAnswerColumns", () => {
  it("keeps identity columns then published match and pit answers", () => {
    expect(EVENT_ANSWER_IDENTITY_COLUMNS.map((column) => column.header)).toEqual([
      "Event",
      "Match",
      "Team",
      "Type",
      "Scout",
      "Source",
      "Confidence",
      "Updated at",
    ]);
    expect(eventAnswerColumns(matchSchema, pitSchema).map((column) => column.header)).toEqual([
      "Event",
      "Match",
      "Team",
      "Type",
      "Scout",
      "Source",
      "Confidence",
      "Updated at",
      "Match · Auto",
      "Match · Cycles · Speaker",
      "Match · Cycles · Amp",
      "Match · Notes",
      "Pit · Drivetrain",
      "Pit · Notes",
    ]);
  });

  it("skips layout-only fields and prefixes colliding match/pit labels", () => {
    const headers = eventAnswerColumns(DEFAULT_MATCH_SCHEMA, DEFAULT_PIT_SCHEMA).map((column) => column.header);
    expect(headers).not.toContain("Teleop");
    expect(headers.filter((header) => header.endsWith(" · Notes"))).toEqual(["Match · Notes", "Pit · Notes"]);
  });
});

describe("eventAnswersCsv", () => {
  it("writes a header-only file when the event has no entries", () => {
    const csv = eventAnswersCsv({ rows: [], matchDefinition: matchSchema, pitDefinition: pitSchema });
    expect(lines(csv)).toHaveLength(1);
    expect(lines(csv)[0]).toContain("Match · Auto");
    expect(lines(csv)[0]).toContain("Pit · Drivetrain");
  });

  it("spreads payload answers across schema columns and leaves the other form blank", () => {
    const csv = eventAnswersCsv({
      matchDefinition: matchSchema,
      pitDefinition: pitSchema,
      rows: [
        row({
          type: "match",
          teamKey: "frc254",
          payload: { auto: 3, cycles: { speaker: 8, amp: 1 }, notes: "clean, \"fast\"" },
        }),
        row({
          type: "pit",
          teamKey: "frc1678",
          payload: { drivetrain_type: "swerve", notes: "photos on the pit card" },
        }),
      ],
    });
    const body = lines(csv);
    expect(body).toHaveLength(3);
    expect(body[1]).toContain("2026test_qm1");
    expect(body[1]).toContain("frc254");
    expect(body[1]).toContain(",3,8,1,");
    expect(body[1]).toContain("\"clean, \"\"fast\"\"\"");
    expect(body[1]?.endsWith(",")).toBe(true);
    expect(body[2]).toContain("frc1678");
    expect(body[2]).toContain("swerve");
    expect(body[2]).not.toContain("2026test_qm1");
    expect(body[2]).toMatch(/^2026test,,frc1678,pit,/);
  });

  it("does not invent a data row for missing payload keys", () => {
    const csv = eventAnswersCsv({
      matchDefinition: matchSchema,
      pitDefinition: pitSchema,
      rows: [row({ type: "match", teamKey: "frc111", payload: { auto: 0 } })],
    });
    const data = lines(csv)[1] ?? "";
    expect(data).toContain("frc111");
    expect(data).toContain(",0,,,");
  });
});
