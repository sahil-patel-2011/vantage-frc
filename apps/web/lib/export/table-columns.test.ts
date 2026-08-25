import { describe, expect, it } from "vitest";
import { csvColumnsFromTable, shouldOfferTableExport, type ExportableTableColumn } from "./table-columns";
import { toCsv } from "./to-csv";

type Row = { teamKey: string; epa: number | null; owner: string };

const columns: ExportableTableColumn<Row>[] = [
  { key: "teamKey", header: "Team", exportHint: "TBA team key" },
  // Rendered on screen as a bar chart, so the CSV needs the raw number.
  { key: "epa", header: "EPA", exportValue: (row) => row.epa },
  // Header is a React element in the real table; the key is the honest fallback.
  { key: "owner", header: { type: "span" } },
  { key: "actions", header: "Actions", exportSkip: true },
];

describe("csvColumnsFromTable", () => {
  it("carries string headers through and falls back to the key for non-string headers", () => {
    expect(csvColumnsFromTable(columns).map((column) => column.header)).toEqual(["Team", "EPA", "owner"]);
  });

  it("drops columns marked exportSkip, so action buttons never become a CSV column", () => {
    expect(csvColumnsFromTable(columns).some((column) => column.key === "actions")).toBe(false);
  });

  it("prefers an explicit exportHeader over the on-screen header", () => {
    const [column] = csvColumnsFromTable<Row>([{ key: "epa", header: "EPA", exportHeader: "EPA (total)" }]);
    expect(column?.header).toBe("EPA (total)");
  });

  it("ignores a blank header rather than writing an unnamed column", () => {
    const [column] = csvColumnsFromTable<Row>([{ key: "epa", header: "   " }]);
    expect(column?.header).toBe("epa");
  });

  it("produces a CSV that reads row values by key and by exportValue", () => {
    const csv = toCsv([{ teamKey: "frc254", epa: 62.5, owner: "Ann" }], csvColumnsFromTable(columns), { bom: false });
    expect(csv).toBe("Team,EPA,owner\r\nfrc254,62.5,Ann\r\n");
  });

  it("carries hints through for the tooltip", () => {
    expect(csvColumnsFromTable(columns)[0]?.hint).toBe("TBA team key");
  });
});

describe("shouldOfferTableExport", () => {
  it("offers export by default", () => {
    expect(shouldOfferTableExport(columns)).toBe(true);
  });

  it("respects an explicit opt-out", () => {
    expect(shouldOfferTableExport(columns, { exportable: false })).toBe(false);
  });

  it("never offers export on a table flagged sensitive", () => {
    expect(shouldOfferTableExport(columns, { sensitive: true })).toBe(false);
  });

  it("does not offer an export with nothing in it", () => {
    expect(shouldOfferTableExport<Row>([{ key: "actions", exportSkip: true }])).toBe(false);
  });
});
