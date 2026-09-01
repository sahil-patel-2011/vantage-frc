import { describe, expect, it } from "vitest";
import {
  csvCell,
  exportScopeFor,
  hoursCsv,
  hoursExportFileName,
  visibleLogs,
  type ExportableHourLog,
} from "./export";

const ADA = "aaaaaaaa-1111-4111-8111-111111111111";
const GRACE = "bbbbbbbb-2222-4222-8222-222222222222";

function log(overrides: Partial<ExportableHourLog> = {}): ExportableHourLog {
  return {
    id: "log-1",
    userId: ADA,
    userName: "Ada Lovelace",
    kind: "build",
    clockIn: "2026-02-10T18:00:00.000Z",
    clockOut: "2026-02-10T21:00:00.000Z",
    note: "",
    closedByName: null,
    ...overrides,
  } as ExportableHourLog;
}

const bodyRows = (csv: string) => csv.trim().split("\r\n").slice(1);

describe("exportScopeFor", () => {
  it("gives mentors the team and everyone else themselves", () => {
    expect(exportScopeFor("owner")).toBe("team");
    expect(exportScopeFor("admin")).toBe("team");
    expect(exportScopeFor("member")).toBe("self");
    expect(exportScopeFor(null)).toBe("self");
  });
});

describe("visibleLogs", () => {
  const logs = [log({ id: "a", userId: ADA }), log({ id: "b", userId: GRACE, userName: "Grace" })];

  it("gives a member only their own sessions", () => {
    const visible = visibleLogs(logs, { role: "member", userId: ADA });
    expect(visible.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("gives an admin the whole team", () => {
    expect(visibleLogs(logs, { role: "admin", userId: ADA })).toHaveLength(2);
  });

  it("does not leak a teammate's session to a member with no sessions of their own", () => {
    expect(visibleLogs(logs, { role: "member", userId: "someone-else" })).toEqual([]);
  });
});

describe("csvCell", () => {
  it("quotes commas, quotes, and newlines", () => {
    expect(csvCell("Robot, arm")).toBe('"Robot, arm"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("defuses spreadsheet formula injection in a student-typed note", () => {
    expect(csvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    // A payload that also needs RFC 4180 quoting gets both treatments.
    expect(csvCell("=SUM(A1,B1)")).toBe(`"'=SUM(A1,B1)"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("renders null and undefined as an empty cell, not the word null", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("hoursCsv", () => {
  it("writes a header and one row per session", () => {
    const csv = hoursCsv([log()]);
    expect(csv.split("\r\n")[0]).toContain("Member,Kind,Clock in,Clock out,Hours");
    expect(bodyRows(csv)).toHaveLength(1);
  });

  it("computes hours from the stored timestamps", () => {
    expect(bodyRows(hoursCsv([log()]))[0]).toContain("3.00");
  });

  it("leaves the hours cell blank for a still-open session rather than crediting elapsed time", () => {
    const row = bodyRows(hoursCsv([log({ clockOut: null })]))[0]!.split(",");
    expect(row[3]).toBe("");
    expect(row[4]).toBe("");
    expect(row[5]).toBe("open");
  });

  it("marks a swept session so a school can see it was not scanned out", () => {
    const csv = hoursCsv([
      log({ autoClosed: true, autoClosedReason: "Open 18.0h; credited 4h per team policy." }),
    ]);
    expect(csv).toContain("auto-closed");
    expect(csv).toContain("credited 4h");
  });

  it("orders oldest first so the file reads as a season log", () => {
    const csv = hoursCsv([
      log({ id: "b", clockIn: "2026-03-01T18:00:00.000Z", clockOut: "2026-03-01T19:00:00.000Z", userName: "B" }),
      log({ id: "a", clockIn: "2026-01-01T18:00:00.000Z", clockOut: "2026-01-01T19:00:00.000Z", userName: "A" }),
    ]);
    const rows = bodyRows(csv);
    expect(rows[0]).toContain("A");
    expect(rows[1]).toContain("B");
  });

  it("honours a date window on the clock-in", () => {
    const logs = [
      log({ id: "jan", clockIn: "2026-01-15T18:00:00.000Z", clockOut: "2026-01-15T19:00:00.000Z" }),
      log({ id: "mar", clockIn: "2026-03-15T18:00:00.000Z", clockOut: "2026-03-15T19:00:00.000Z" }),
    ];
    expect(bodyRows(hoursCsv(logs, { from: "2026-03-01" }))).toHaveLength(1);
    expect(bodyRows(hoursCsv(logs, { to: "2026-02-01" }))).toHaveLength(1);
    expect(bodyRows(hoursCsv(logs, { from: "2026-01-01", to: "2026-12-31" }))).toHaveLength(2);
  });

  it("includes a same-day session when from and to are that day", () => {
    const csv = hoursCsv([log()], { from: "2026-02-10", to: "2026-02-10" });
    expect(bodyRows(csv)).toHaveLength(1);
  });

  it("names an unnamed member instead of writing an empty cell", () => {
    expect(hoursCsv([log({ userName: null })])).toContain("Unknown member");
  });

  it("produces a header-only file when there is nothing to export", () => {
    expect(bodyRows(hoursCsv([]))).toEqual([]);
  });
});

describe("hoursExportFileName", () => {
  it("names the file after the team, scope, and date", () => {
    expect(hoursExportFileName({ teamNumber: 254, scope: "team", today: "2026-03-10" })).toBe(
      "team-254-hours-team-2026-03-10.csv",
    );
  });

  it("falls back gracefully when the org has no team number", () => {
    expect(hoursExportFileName({ teamNumber: null, scope: "self", today: "2026-03-10" })).toBe(
      "team-hours-self-2026-03-10.csv",
    );
  });
});
