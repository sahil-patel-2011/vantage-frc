import { describe, expect, it } from "vitest";
import {
  exportShooterConstants,
  formatLoggedNumber,
  loggedHoodRows,
  loggedRpmRows,
  parseShooterExportLanguage,
  shooterExportFileName,
  type LoggedShooterRow,
} from "./export";

const LOGGED: LoggedShooterRow[] = [
  { distanceFt: 12.5, rpm: 3410, hoodAngle: 38.25, tableName: "Shooter" },
  { distanceFt: 5, rpm: 2875.5, hoodAngle: 28, tableName: "Shooter" },
];

const EMPTY_MARKERS = ["does not invent RPM", "0 RPM rows, 0 hood rows"];

function javaExport(rows: LoggedShooterRow[]) {
  return exportShooterConstants(rows, { seasonYear: 2026, language: "java" });
}

describe("loggedRpmRows / loggedHoodRows", () => {
  it("keeps only the field that was actually logged", () => {
    const mixed: LoggedShooterRow[] = [
      { distanceFt: 8, rpm: 3100, hoodAngle: null },
      { distanceFt: 16, rpm: null, hoodAngle: 44 },
      { distanceFt: 20, rpm: null, hoodAngle: null },
    ];
    expect(loggedRpmRows(mixed).map((row) => row.value)).toEqual([3100]);
    expect(loggedHoodRows(mixed).map((row) => row.value)).toEqual([44]);
  });

  it("orders by distance so the robot table is monotonic", () => {
    expect(loggedRpmRows(LOGGED).map((row) => row.distanceFt)).toEqual([5, 12.5]);
  });
});

describe("formatLoggedNumber", () => {
  it("prints the stored measurement without rounding to a nicer RPM", () => {
    expect(formatLoggedNumber(2875.5)).toBe("2875.5");
    expect(formatLoggedNumber(3410)).toBe("3410");
  });
});

describe("exportShooterConstants — real rows", () => {
  it("emits the logged Java pairs and not an interpolated midpoint RPM", () => {
    const text = javaExport(LOGGED);
    expect(text).toContain("{5, 2875.5}");
    expect(text).toContain("{12.5, 3410}");
    expect(text).toContain("{5, 28}");
    expect(text).toContain("{12.5, 38.25}");
    expect(text).toContain("2 RPM rows, 2 hood rows");
    // Halfway between 5 ft / 2875.5 and 12.5 ft / 3410 would be 3142.75 at 8.75 ft.
    expect(text).not.toContain("3142.75");
    expect(text).not.toContain("8.75");
  });

  it("does not invent RPM for a hood-only row", () => {
    const text = javaExport([{ distanceFt: 9, rpm: null, hoodAngle: 33 }]);
    expect(text).toContain("kRpmByDistanceFt = {}");
    expect(text).toContain("{9, 33}");
    expect(text).toContain("0 RPM rows, 1 hood row");
    expect(text).not.toMatch(/\b3000\b/);
    expect(text).not.toMatch(/\b2500\b/);
  });

  it("writes C++ counts and arrays from the same logged values", () => {
    const text = exportShooterConstants(LOGGED, { seasonYear: 2026, language: "cpp" });
    expect(text).toContain("kRpmCount = 2");
    expect(text).toContain("kRpm[kRpmCount] = {2875.5, 3410}");
    expect(text).toContain("kHoodDeg[kHoodCount] = {28, 38.25}");
    expect(text).not.toContain("3142.75");
  });

  it("writes Python tuples from the same logged values", () => {
    const text = exportShooterConstants(LOGGED, { seasonYear: 2026, language: "python" });
    expect(text).toContain("(5, 2875.5)");
    expect(text).toContain("(12.5, 3410)");
    expect(text).toContain("(5, 28)");
    expect(text).not.toContain("3142.75");
  });
});

describe("exportShooterConstants — empty", () => {
  it("emits empty Java tables and no sample flywheel RPM", () => {
    const text = javaExport([]);
    expect(text).toContain("kRpmByDistanceFt = {}");
    expect(text).toContain("kHoodDegByDistanceFt = {}");
    for (const marker of EMPTY_MARKERS) expect(text).toContain(marker);
    expect(text).not.toMatch(/\b3000\b/);
    expect(text).not.toMatch(/\b2500\b/);
    expect(text).not.toMatch(/\b4000\b/);
    expect(text).not.toMatch(/kRpmByDistanceFt = \{\s*\{/);
  });

  it("emits zero-count C++ tables instead of a placeholder RPM", () => {
    const text = exportShooterConstants([], { seasonYear: 2026, language: "cpp" });
    expect(text).toContain("kRpmCount = 0");
    expect(text).toContain("kHoodCount = 0");
    expect(text).not.toContain("kRpm[kRpmCount]");
    expect(text).not.toMatch(/\b3000\b/);
  });

  it("emits empty Python tuples instead of a sample table", () => {
    const text = exportShooterConstants([], { seasonYear: 2026, language: "python" });
    expect(text).toContain("k_rpm_by_distance_ft = ()");
    expect(text).toContain("k_hood_deg_by_distance_ft = ()");
    expect(text).toContain("does not invent RPM");
    expect(text).not.toMatch(/\b3000\b/);
  });
});

describe("parseShooterExportLanguage / shooterExportFileName", () => {
  it("defaults to java and accepts aliases", () => {
    expect(parseShooterExportLanguage(undefined)).toBe("java");
    expect(parseShooterExportLanguage("C++")).toBe("cpp");
    expect(parseShooterExportLanguage("py")).toBe("python");
  });

  it("rejects an unknown language rather than falling back to a sample file", () => {
    expect(() => parseShooterExportLanguage("javascript")).toThrow(/lang must be/);
  });

  it("names the download after the season and language", () => {
    expect(shooterExportFileName({ language: "java", seasonYear: 2026 })).toBe("ShooterTable2026.java");
    expect(shooterExportFileName({ language: "cpp", seasonYear: 2026 })).toBe("ShooterTable2026.h");
    expect(shooterExportFileName({ language: "python", seasonYear: 2026 })).toBe("shooter_table_2026.py");
  });
});
