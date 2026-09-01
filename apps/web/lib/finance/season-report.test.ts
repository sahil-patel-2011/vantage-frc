import { describe, expect, it } from "vitest";
import { toCsv } from "../export/to-csv";
import { isHonestTieOut } from "./honesty";
import { sumLedgerEntries, type UnifiedLedgerEntry } from "./ledger";
import {
  SEASON_REPORT_COLUMNS,
  buildSeasonReportRows,
  closingBalanceUsd,
} from "./season-report";

function entry(overrides: Partial<UnifiedLedgerEntry>): UnifiedLedgerEntry {
  return {
    id: "row-1",
    date: "2026-03-01T00:00:00Z",
    label: "Entry",
    amountUsd: 100,
    direction: "out",
    source: "manual",
    sourceId: null,
    categoryId: null,
    categoryName: null,
    mirrored: true,
    ...overrides,
  };
}

describe("buildSeasonReportRows", () => {
  it("runs oldest-first with a cumulative balance", () => {
    const rows = buildSeasonReportRows([
      entry({ id: "c", date: "2026-03-03T00:00:00Z", direction: "out", amountUsd: 50 }),
      entry({ id: "a", date: "2026-03-01T00:00:00Z", direction: "in", amountUsd: 500 }),
      entry({ id: "b", date: "2026-03-02T00:00:00Z", direction: "out", amountUsd: 120.25 }),
    ]);
    expect(rows.map((row) => row.date)).toEqual([
      "2026-03-01T00:00:00Z",
      "2026-03-02T00:00:00Z",
      "2026-03-03T00:00:00Z",
    ]);
    expect(rows.map((row) => row.runningBalanceUsd)).toEqual([500, 379.75, 329.75]);
    expect(rows[0]).toMatchObject({ inUsd: 500, outUsd: 0, direction: "in" });
    expect(rows[1]).toMatchObject({ inUsd: 0, outUsd: 120.25, direction: "out" });
  });

  it("closes on exactly the ledger balance — the handoff document's whole job", () => {
    const entries = [
      entry({ id: "a", date: "2026-01-01T00:00:00Z", direction: "in", amountUsd: 1200.33 }),
      entry({ id: "b", date: "2026-01-05T00:00:00Z", direction: "out", amountUsd: 199.99 }),
      entry({ id: "c", date: "2026-02-05T00:00:00Z", direction: "out", amountUsd: 45.01 }),
      entry({ id: "d", date: "2026-02-06T00:00:00Z", direction: "in", amountUsd: 0.67 }),
    ];
    const rows = buildSeasonReportRows(entries);
    expect(closingBalanceUsd(rows)).toBe(sumLedgerEntries(entries).balanceUsd);
  });

  it("stays cent-exact over a long season instead of drifting", () => {
    const entries = Array.from({ length: 400 }, (_, index) =>
      entry({
        id: `row-${index}`,
        date: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
        direction: index % 2 === 0 ? "in" : "out",
        amountUsd: 10.01,
      }),
    );
    expect(closingBalanceUsd(buildSeasonReportRows(entries))).toBe(0);
  });

  it("puts money in before money out on the same instant so the balance never dips falsely", () => {
    const rows = buildSeasonReportRows([
      entry({ id: "out", direction: "out", amountUsd: 400 }),
      entry({ id: "in", direction: "in", amountUsd: 400 }),
    ]);
    expect(rows.map((row) => row.direction)).toEqual(["in", "out"]);
    expect(rows.map((row) => row.runningBalanceUsd)).toEqual([400, 0]);
  });

  it("drops zero, non-finite, and unmirrored fallback rows rather than exporting invented money", () => {
    const rows = buildSeasonReportRows([
      entry({ id: "zero", amountUsd: 0 }),
      entry({ id: "nan", amountUsd: Number.NaN }),
      entry({ id: "fallback", amountUsd: 400, mirrored: false, source: "purchase_request" }),
      entry({ id: "real", amountUsd: 10, direction: "out" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.runningBalanceUsd).toBe(-10);
  });

  it("labels the origin of every row and leaves an unknown category blank, never guessed", () => {
    const [withCategory, without] = buildSeasonReportRows([
      entry({ id: "a", date: "2026-03-01T00:00:00Z", source: "reimbursement", categoryName: "Travel" }),
      entry({ id: "b", date: "2026-03-02T00:00:00Z", source: "purchase_request", categoryName: null }),
    ]);
    expect(withCategory).toMatchObject({ sourceLabel: "Reimbursement", category: "Travel" });
    expect(without).toMatchObject({ sourceLabel: "Order", category: "" });
  });

  it("returns an empty report — and a zero closing balance — for a team with no money rows", () => {
    expect(buildSeasonReportRows([])).toEqual([]);
    expect(closingBalanceUsd([])).toBe(0);
    expect(isHonestTieOut({ closingUsd: 0, reportedBalanceUsd: 0, rowCount: 0 })).toBe(false);
  });
});

describe("season report CSV", () => {
  it("writes a self-describing header even when the team has no rows", () => {
    const csv = toCsv([], SEASON_REPORT_COLUMNS);
    expect(csv).toContain("Running balance (USD)");
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });

  it("keeps money unformatted and dates ISO so the receiving spreadsheet can do maths", () => {
    const rows = buildSeasonReportRows([
      entry({ id: "a", date: "2026-03-01T00:00:00Z", label: "Gearbox", direction: "out", amountUsd: 1200.5 }),
    ]);
    const csv = toCsv(rows, SEASON_REPORT_COLUMNS);
    expect(csv).toContain("2026-03-01T00:00:00Z");
    expect(csv).toContain("1200.5");
    expect(csv).not.toContain("$1,200.50");
  });

  it("guards a formula-shaped description against executing in Excel", () => {
    const rows = buildSeasonReportRows([entry({ id: "a", label: "=cmd|calc" })]);
    expect(toCsv(rows, SEASON_REPORT_COLUMNS)).toContain("'=cmd|calc");
  });
});

describe("season report honesty", () => {
  it("skips unmirrored fallback income instead of re-reading source tables", () => {
    const rows = buildSeasonReportRows([
      entry({
        id: "sponsor-fallback",
        direction: "in",
        amountUsd: 1200,
        source: "sponsor_contribution",
        mirrored: false,
      }),
      entry({
        id: "grant-fallback",
        direction: "in",
        amountUsd: 500,
        source: "other",
        mirrored: false,
      }),
    ]);
    expect(rows).toEqual([]);
    expect(closingBalanceUsd(rows)).toBe(0);
    expect(isHonestTieOut({ closingUsd: 0, reportedBalanceUsd: 0, rowCount: 0 })).toBe(false);
  });

  it("ties out only when real ledger rows close on the balance view", () => {
    const entries = [
      entry({ id: "a", date: "2026-01-01T00:00:00Z", direction: "in", amountUsd: 1200.33 }),
      entry({ id: "b", date: "2026-01-05T00:00:00Z", direction: "out", amountUsd: 199.99 }),
    ];
    const rows = buildSeasonReportRows(entries);
    expect(
      isHonestTieOut({
        closingUsd: closingBalanceUsd(rows),
        reportedBalanceUsd: sumLedgerEntries(entries).balanceUsd,
        rowCount: rows.length,
      }),
    ).toBe(true);
  });
});
