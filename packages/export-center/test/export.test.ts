import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  buildTextPdf,
  createExportRegistry,
  csvHeader,
  csvRow,
  EXPORT_EXCLUSIONS,
  inspectExportManifest,
} from "../src";

describe("secure CSV exports", () => {
  it("uses RFC 4180 quoting and neutralizes spreadsheet formulas", () => {
    expect(csvHeader(["name", "notes"], true)).toBe('\uFEFF"name","notes"\r\n');
    expect(csvRow(["name", "notes"], { name: "Alpha, Beta", notes: '=HYPERLINK("bad")' })).toBe(
      '"Alpha, Beta","\'=HYPERLINK(""bad"")"\r\n',
    );
  });

  it("registers only explicit redacted domains", () => {
    const text = JSON.stringify(
      [...createExportRegistry().values()].map((item) => ({
        id: item.id,
        columns: item.columns,
        category: item.category,
        provenance: item.provenance,
      })),
    );
    for (const secret of [
      "api_key",
      "token_hash",
      "password",
      "encrypted_secret",
      "mfa",
      "otp",
      "session_token",
      "display_token",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("offers a privacy-safe Purple Standard scouting adapter", () => {
    const adapter = createExportRegistry().get("scouting-purple-standard");
    expect(adapter).toMatchObject({
      fileName: "scouting_purple_standard.csv",
      category: "scouting",
      scope: "team",
      columns: ["abilities", "counters", "data", "metadata", "ratings", "timers"],
    });
    expect(JSON.stringify(adapter)).not.toContain("scout_user_id");
  });

  it("exports the cross-feature provenance graph without member identity", () => {
    const adapter = createExportRegistry().get("feature-context-links");
    expect(adapter).toMatchObject({
      fileName: "feature_context_links.csv",
      scope: "team",
      columns: ["id", "source_kind", "source_id", "target_kind", "target_id", "relation", "metadata_json", "created_at"],
    });
    expect(adapter?.columns).not.toContain("created_by");
  });

  it("reads a versioned ZIP manifest with provenance metadata", () => {
    const manifest = {
      format: "Vantage Team Data Export",
      version: 2,
      exclusions: EXPORT_EXCLUSIONS,
      files: [{ name: "scouting_match_entries.csv", domain: "scouting-match", category: "scouting", provenance: "test" }],
    };
    const archive = zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "PROVENANCE.txt": strToU8("Vantage export provenance"),
    });
    expect(inspectExportManifest(archive)).toEqual(manifest);
    expect(Object.keys(unzipSync(archive))).toContain("PROVENANCE.txt");
  });
});

describe("buildTextPdf", () => {
  it("returns a minimal Helvetica PDF and escapes PDF syntax characters", () => {
    const pdf = buildTextPdf({
      title: "Inventory (test)",
      subtitle: "Scope: team",
      lines: ["Line with \\ backslash", "Line with (parens) and [brackets]", ...Array.from({ length: 60 }, (_, i) => `Row ${i + 1}`)],
      footer: "Vantage",
    });
    const header = Buffer.from(pdf.slice(0, 8)).toString("utf8");
    expect(header.startsWith("%PDF-1.")).toBe(true);
    const body = Buffer.from(pdf).toString("utf8");
    expect(body).toContain("Inventory \\(test\\)");
    expect(body).toContain("Line with \\\\ backslash");
  });
});
