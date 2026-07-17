import { describe, expect, it } from "vitest";
import { parseNotebookAction, parseTags, summarizeNotebook, validateEntry } from "./notebook";

describe("parseTags", () => {
  it("splits, trims, lowercases and dedupes a comma string", () => {
    expect(parseTags("Drivetrain, drivetrain , SwerveX ")).toEqual(["drivetrain", "swervex"]);
  });
  it("accepts an array and caps at 10 tags", () => {
    expect(parseTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
  });
  it("returns empty for junk input", () => {
    expect(parseTags(42)).toEqual([]);
  });
});

describe("validateEntry", () => {
  it("requires a title", () => {
    expect(validateEntry({ entryDate: "2026-01-10", phase: "design" }).ok).toBe(false);
  });
  it("rejects an invalid phase", () => {
    expect(validateEntry({ title: "Intake v1", entryDate: "2026-01-10", phase: "welding" }).ok).toBe(false);
  });
  it("rejects a bad date", () => {
    expect(validateEntry({ title: "Intake v1", entryDate: "nope", phase: "design" }).ok).toBe(false);
  });
  it("accepts a valid entry and parses tags", () => {
    const result = validateEntry({ title: "Intake v1", entryDate: "2026-01-10", phase: "design", subsystem: "Intake", tags: "cad, prototype" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tags).toEqual(["cad", "prototype"]);
  });
});

describe("summarizeNotebook", () => {
  it("rolls up counts by subsystem and phase and finds the latest date", () => {
    const summary = summarizeNotebook([
      { subsystem: "Intake", phase: "design", entryDate: "2026-01-10" },
      { subsystem: "Intake", phase: "prototype", entryDate: "2026-01-15" },
      { subsystem: "", phase: "brainstorm", entryDate: "2026-01-05" },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.subsystems[0]).toEqual({ name: "Intake", count: 2 });
    expect(summary.subsystems.some((s) => s.name === "General")).toBe(true);
    expect(summary.lastEntryOn).toBe("2026-01-15");
  });
  it("handles an empty notebook", () => {
    expect(summarizeNotebook([]).lastEntryOn).toBeNull();
  });
});

describe("parseNotebookAction", () => {
  it("parses create_entry with a season year", () => {
    const action = parseNotebookAction({ action: "create_entry", orgId: "o1", seasonYear: 2026, title: "Intake v1", entryDate: "2026-01-10", phase: "design" });
    expect(action).toMatchObject({ action: "create_entry", seasonYear: 2026, phase: "design" });
  });
  it("rejects create_entry with no season year", () => {
    expect(() => parseNotebookAction({ action: "create_entry", orgId: "o1", title: "x", entryDate: "2026-01-10", phase: "design" })).toThrow(/seasonYear/);
  });
  it("rejects update_entry with no changes", () => {
    expect(() => parseNotebookAction({ action: "update_entry", orgId: "o1", id: "e1" })).toThrow(/No changes/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseNotebookAction({ action: "burn", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
