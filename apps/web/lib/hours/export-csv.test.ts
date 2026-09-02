import { describe, expect, it } from "vitest";
import {
  buildHoursCsv,
  hoursExportFileName,
  hoursExportRows,
  parseHoursExportRange,
  sessionMinutes,
  type HoursExportLog,
} from "./export-csv";

function log(overrides: Partial<HoursExportLog> = {}): HoursExportLog {
  return {
    id: "l-1",
    kind: "build",
    clockIn: "2026-02-03T23:00:00.000Z",
    clockOut: "2026-02-04T01:30:00.000Z",
    note: "",
    autoClosed: false,
    autoClosedReason: null,
    linkedEventTitle: null,
    occurrenceDate: null,
    ...overrides,
  };
}

describe("parseHoursExportRange", () => {
  it("accepts open-ended and bounded ISO dates", () => {
    expect(parseHoursExportRange(null, null)).toEqual({ from: null, to: null });
    expect(parseHoursExportRange("2026-01-01", "")).toEqual({ from: "2026-01-01", to: null });
    expect(parseHoursExportRange("2026-01-01", "2026-02-01")).toEqual({ from: "2026-01-01", to: "2026-02-01" });
  });

  it("rejects malformed values and inverted ranges", () => {
    expect(parseHoursExportRange("Jan 1", null)).toBeNull();
    expect(parseHoursExportRange("2026-13-40", null)).toBeNull();
    expect(parseHoursExportRange("2026-03-01", "2026-02-01")).toBeNull();
    expect(parseHoursExportRange(5, null)).toBeNull();
  });
});

describe("sessionMinutes", () => {
  it("rounds closed sessions to whole minutes and leaves open ones empty", () => {
    expect(sessionMinutes(log())).toBe(150);
    expect(sessionMinutes(log({ clockOut: null }))).toBeNull();
    expect(sessionMinutes(log({ clockOut: "2026-02-03T22:00:00.000Z" }))).toBeNull();
  });
});

describe("hoursExportRows", () => {
  it("flags auto-closed sessions and carries the linked event", () => {
    const rows = hoursExportRows([
      log({
        id: "b",
        clockIn: "2026-02-05T00:00:00.000Z",
        autoClosed: true,
        autoClosedReason: "Forgot to sign out",
        linkedEventTitle: "Tuesday build",
        occurrenceDate: "2026-02-04",
      }),
      log({ id: "a", clockOut: null, note: "left early" }),
    ]);
    // Oldest clock-in first regardless of input order.
    expect(rows.map((row) => row.date)).toEqual(["2026-02-03", "2026-02-05"]);
    expect(rows[0]).toMatchObject({ clock_out: "", minutes: "", auto_closed: "no", note: "left early" });
    expect(rows[1]).toMatchObject({
      auto_closed: "yes",
      auto_closed_reason: "Forgot to sign out",
      linked_event: "Tuesday build",
      occurrence_date: "2026-02-04",
    });
  });

  it("never emits a reason for a session that was not auto-closed", () => {
    const [row] = hoursExportRows([log({ autoClosedReason: "stale" })]);
    expect(row?.auto_closed_reason).toBe("");
  });
});

describe("buildHoursCsv", () => {
  it("writes a header plus one quoted row per session", () => {
    const csv = buildHoursCsv([log({ note: 'said "hi"' })]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"date","clock_in","clock_out","minutes"');
    expect(lines[1]).toContain('"150"');
    expect(lines[1]).toContain('"said ""hi"""');
  });

  it("neutralises spreadsheet formula prefixes", () => {
    const csv = buildHoursCsv([log({ note: "=HYPERLINK(x)" })]);
    expect(csv).toContain(`"'=HYPERLINK(x)"`);
  });
});

describe("hoursExportFileName", () => {
  it("slugs the member and range", () => {
    expect(hoursExportFileName({ memberName: "Riya Patel!", range: { from: "2026-01-01", to: null } })).toBe(
      "hours_riya-patel_2026-01-01_now.csv",
    );
    expect(hoursExportFileName({ memberName: null, range: { from: null, to: null } })).toBe("hours_member_start_now.csv");
  });
});
