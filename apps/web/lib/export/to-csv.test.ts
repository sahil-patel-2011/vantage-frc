import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  CSV_EOL,
  csvCell,
  csvFileName,
  csvText,
  describeCsvColumns,
  quoteCsvField,
  toCsv,
  type CsvColumn,
} from "./to-csv";

type Row = {
  team: string;
  note: string | null;
  points: number;
  scored: boolean;
  at: Date;
  tags?: string[];
};

const columns: CsvColumn<Row>[] = [
  { key: "team", header: "Team", hint: "FRC team number" },
  { key: "note", header: "Note" },
  { key: "points", header: "Points" },
  { key: "scored", header: "Scored" },
  { key: "at", header: "Recorded at" },
];

function lines(csv: string): string[] {
  return csv.replace(CSV_BOM, "").split(CSV_EOL);
}

describe("CSV_BOM", () => {
  it("is exactly U+FEFF so Excel detects UTF-8", () => {
    expect(CSV_BOM).toBe("﻿");
    expect(CSV_BOM).toHaveLength(1);
  });
});

describe("csvText", () => {
  it("maps null and undefined to an empty field, never the string null", () => {
    expect(csvText(null)).toEqual({ text: "", numeric: false });
    expect(csvText(undefined)).toEqual({ text: "", numeric: false });
  });

  it("writes numbers unformatted — no thousands separators, no locale decimal comma", () => {
    expect(csvText(1234567.5)).toEqual({ text: "1234567.5", numeric: true });
    expect(csvText(0)).toEqual({ text: "0", numeric: true });
    expect(csvText(-42)).toEqual({ text: "-42", numeric: true });
  });

  it("empties NaN and Infinity rather than writing an unusable cell", () => {
    expect(csvText(Number.NaN).text).toBe("");
    expect(csvText(Number.POSITIVE_INFINITY).text).toBe("");
  });

  it("writes Date as ISO-8601 and an invalid Date as empty", () => {
    expect(csvText(new Date("2026-04-18T14:05:00.000Z")).text).toBe("2026-04-18T14:05:00.000Z");
    expect(csvText(new Date("nope")).text).toBe("");
  });

  it("joins primitive arrays and drops objects instead of dumping [object Object]", () => {
    expect(csvText(["auto", "defense"]).text).toBe("auto; defense");
    expect(csvText({ react: "element" }).text).toBe("");
    expect(csvText([{ a: 1 }, "kept"]).text).toBe("kept");
  });

  it("writes booleans as true/false", () => {
    expect(csvText(true).text).toBe("true");
    expect(csvText(false).text).toBe("false");
  });
});

describe("quoteCsvField", () => {
  it("leaves a plain field unquoted", () => {
    expect(quoteCsvField("frc1234")).toBe("frc1234");
  });

  it("quotes a field containing a comma", () => {
    expect(quoteCsvField("Ann, Bob")).toBe('"Ann, Bob"');
  });

  it("doubles quotes and wraps the field", () => {
    expect(quoteCsvField('He said "go"')).toBe('"He said ""go"""');
  });

  it("quotes fields containing CR or LF so a note cannot split a record", () => {
    expect(quoteCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(quoteCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
});

describe("csvCell formula-injection guard", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+1", "'+1"],
    ["-cmd", "'-cmd"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tstart", "'\tstart"],
  ])("prefixes text starting with %j so Excel cannot execute it", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("guards a CR-led cell and still quotes it, because CR would otherwise split the record", () => {
    expect(csvCell("\rstart")).toBe('"\'\rstart"');
  });

  it("leaves ordinary text untouched", () => {
    expect(csvCell("Rookie All Star")).toBe("Rookie All Star");
  });

  it("guards the classic DDE payload", () => {
    expect(csvCell('=cmd|" /C calc"!A0')).toBe('"\'=cmd|"" /C calc""!A0"');
  });

  it("never prefixes a negative number, so -5 stays the number -5", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(-0.25)).toBe("-0.25");
  });

  it("can be turned off for machine pipelines", () => {
    expect(csvCell("=1+1", false)).toBe("=1+1");
  });
});

describe("toCsv", () => {
  const rows: Row[] = [
    {
      team: "frc1234",
      note: 'Fast, "reliable"',
      points: 1234.5,
      scored: true,
      at: new Date("2026-04-18T14:05:00.000Z"),
    },
    { team: "frc9999", note: null, points: -3, scored: false, at: new Date("2026-04-18T15:00:00.000Z") },
  ];

  it("starts with a UTF-8 BOM by default so accented names open correctly in Excel", () => {
    expect(toCsv(rows, columns).startsWith("﻿")).toBe(true);
    expect(toCsv(rows, columns, { bom: false }).startsWith("﻿")).toBe(false);
  });

  it("preserves accented characters verbatim", () => {
    const csv = toCsv([{ name: "José Muñoz" }], [{ key: "name", header: "Name" }], { bom: false });
    expect(csv).toContain("José Muñoz");
  });

  it("uses CRLF line endings and ends the last record with one", () => {
    const csv = toCsv(rows, columns, { bom: false });
    expect(csv.endsWith(CSV_EOL)).toBe(true);
    expect(csv.split(CSV_EOL).filter(Boolean)).toHaveLength(3);
    expect(csv).not.toMatch(/[^\r]\n/);
  });

  it("writes the header row from column headers", () => {
    expect(lines(toCsv(rows, columns))[0]).toBe("Team,Note,Points,Scored,Recorded at");
  });

  it("writes a header-only file when there are no rows, so the export is still self-describing", () => {
    const csv = toCsv([], columns, { bom: false });
    expect(csv).toBe(`Team,Note,Points,Scored,Recorded at${CSV_EOL}`);
  });

  it("escapes, formats and empties every cell type in one pass", () => {
    expect(lines(toCsv(rows, columns))[1]).toBe(
      'frc1234,"Fast, ""reliable""",1234.5,true,2026-04-18T14:05:00.000Z',
    );
    expect(lines(toCsv(rows, columns))[2]).toBe("frc9999,,-3,false,2026-04-18T15:00:00.000Z");
  });

  it("reads row[key] by default and a value() accessor when given", () => {
    const csv = toCsv(
      rows,
      [
        { key: "team" },
        { key: "double", header: "Double", value: (row) => row.points * 2 },
      ],
      { bom: false },
    );
    expect(lines(csv)[0]).toBe("team,Double");
    expect(lines(csv)[1]).toBe("frc1234,2469");
  });

  it("emits an empty cell for a missing key rather than the word undefined", () => {
    const csv = toCsv(rows, [{ key: "tags", header: "Tags" }], { bom: false });
    expect(lines(csv)[1]).toBe("");
  });

  it("guards a formula-looking header too — the header row executes in Excel just like a body row", () => {
    const csv = toCsv([], [{ key: "delta", header: "=SUM(A:A)" }], { bom: false });
    expect(lines(csv)[0]).toBe("'=SUM(A:A)");
  });

  it("empties a value() that returns an object, so a rich domain value never becomes [object Object]", () => {
    // Real case: a match result is { result, us, opp } — only .result belongs in a cell.
    const csv = toCsv(
      rows,
      [{ key: "outcome", header: "Outcome", value: () => ({ result: "W", us: 88, opp: 71 }) }],
      { bom: false },
    );
    expect(lines(csv)[1]).toBe("");
  });
});

describe("csvFileName", () => {
  const at = new Date(2026, 3, 18, 20, 30);

  it("builds feature-org-date.csv", () => {
    expect(csvFileName("Scouting entries", "Team 1234", at)).toBe("scouting-entries-team-1234-2026-04-18.csv");
  });

  it("uses the local calendar date, not UTC, so an 8pm export is not dated tomorrow", () => {
    expect(csvFileName("rankings", null, at)).toBe("rankings-2026-04-18.csv");
  });

  it("slugifies accents and punctuation out of the filename", () => {
    expect(csvFileName("Grant Radar", "Équipe Québec!", at)).toBe("grant-radar-equipe-quebec-2026-04-18.csv");
  });

  it("falls back to export when the feature slugifies to nothing", () => {
    expect(csvFileName("///", null, at)).toBe("export-2026-04-18.csv");
  });
});

describe("describeCsvColumns", () => {
  it("lists headers and appends hints for the what's-in-this-file tooltip", () => {
    expect(describeCsvColumns(columns)).toEqual([
      "Team — FRC team number",
      "Note",
      "Points",
      "Scored",
      "Recorded at",
    ]);
  });
});
