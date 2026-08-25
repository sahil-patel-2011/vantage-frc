import { describe, expect, it } from "vitest";
import {
  csvCell,
  dmExportFilename,
  dmExportSummary,
  normalizeExportFormat,
  normalizeExportReason,
  toDmExportCsv,
  type DmExportRow,
} from "./dm-export";

const row = (over: Partial<DmExportRow> = {}): DmExportRow => ({
  conversationId: "c1",
  messageId: "m1",
  sentAt: "2026-03-04T18:02:00.000Z",
  deletedAt: null,
  authorUserId: "u1",
  authorName: "Ali Mentor",
  authorEmail: "ali@example.org",
  body: "Ride leaves at 6",
  counterparties: "Sam Student",
  supervisors: "Dana Coach",
  ...over,
});

describe("normalizeExportReason", () => {
  it("requires a written reason", () => {
    expect(() => normalizeExportReason("")).toThrow(/reason/i);
    expect(() => normalizeExportReason("why")).toThrow(/at least/i);
    expect(() => normalizeExportReason("x".repeat(501))).toThrow(/under/i);
  });

  it("keeps a real reason verbatim, trimmed", () => {
    expect(normalizeExportReason("  district safeguarding request 2026-03  ")).toBe(
      "district safeguarding request 2026-03",
    );
  });
});

describe("normalizeExportFormat", () => {
  it("defaults to json and accepts csv", () => {
    expect(normalizeExportFormat(undefined)).toBe("json");
    expect(normalizeExportFormat("CSV")).toBe("csv");
    expect(normalizeExportFormat("xlsx")).toBe("json");
  });
});

describe("csv formatting", () => {
  it("quotes and escapes", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("defuses spreadsheet formula injection", () => {
    expect(csvCell("=cmd|'/c calc'!A1")).toBe(`"'=cmd|'/c calc'!A1"`);
    expect(csvCell("+1 555")).toBe(`"'+1 555"`);
  });

  it("emits a header row and one row per message", () => {
    const csv = toDmExportCsv([row(), row({ messageId: "m2", body: "ok" })]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"conversationId"');
    expect(lines[0]).toContain('"supervisors"');
    expect(lines[1]).toContain('"Ride leaves at 6"');
  });
});

describe("dmExportFilename", () => {
  it("is boring and filesystem-safe", () => {
    expect(dmExportFilename("Sam O'Student", "csv", new Date("2026-03-04T00:00:00Z"))).toBe(
      "dm-history-sam-o-student-2026-03-04.csv",
    );
    expect(dmExportFilename("!!!", "json", new Date("2026-03-04T00:00:00Z"))).toBe(
      "dm-history-member-2026-03-04.json",
    );
  });
});

describe("dmExportSummary", () => {
  it("counts conversations, deletions, and the span", () => {
    const summary = dmExportSummary([
      row(),
      row({ messageId: "m2", conversationId: "c2", sentAt: "2026-01-01T00:00:00.000Z" }),
      row({ messageId: "m3", deletedAt: "2026-03-05T00:00:00.000Z" }),
    ]);
    expect(summary).toEqual({
      messageCount: 3,
      conversationCount: 2,
      deletedCount: 1,
      firstSentAt: "2026-01-01T00:00:00.000Z",
      lastSentAt: "2026-03-04T18:02:00.000Z",
    });
  });

  it("reports an honest empty summary", () => {
    expect(dmExportSummary([])).toEqual({
      messageCount: 0,
      conversationCount: 0,
      deletedCount: 0,
      firstSentAt: null,
      lastSentAt: null,
    });
  });
});
