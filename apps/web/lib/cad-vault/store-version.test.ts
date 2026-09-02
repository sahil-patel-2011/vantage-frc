import { describe, expect, it } from "vitest";
import { cadVaultDocumentHref, cadVaultTitle, prepareCadVaultFile } from "./store-version";

function asciiStl(): Buffer {
  return Buffer.from(
    [
      "solid cube",
      "facet normal 0 0 1",
      "outer loop",
      "vertex 0 0 0",
      "vertex 10 0 0",
      "vertex 0 10 0",
      "endloop",
      "endfacet",
      "endsolid cube",
      "",
    ].join("\n"),
    "utf8",
  );
}

describe("cadVaultTitle", () => {
  it("trims, collapses whitespace, caps at 160 and falls back", () => {
    expect(cadVaultTitle("  Drive   plate ")).toBe("Drive plate");
    expect(cadVaultTitle("x".repeat(200))).toHaveLength(160);
    expect(cadVaultTitle("")).toBe("Part Studio export");
    expect(cadVaultTitle("   ", "Fallback")).toBe("Fallback");
  });

  it("deep-links the vault by org and document", () => {
    expect(cadVaultDocumentHref("org 1", "doc/2")).toBe("/cad-vault?orgId=org%201&document=doc%2F2");
  });
});

describe("prepareCadVaultFile", () => {
  it("detects an ASCII STL, hashes it and summarises its geometry", async () => {
    const prepared = await prepareCadVaultFile(asciiStl(), "Drive plate (v2).stl");
    expect(prepared.format).toBe("stl");
    expect(prepared.mediaType).toBe("model/stl");
    expect(prepared.filename).toBe("Drive-plate-v2.stl");
    expect(prepared.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.geometry).toMatchObject({ triangleCount: 1 });
  });

  it("rejects an empty file and an unknown format with a user-facing message", async () => {
    await expect(prepareCadVaultFile(Buffer.alloc(0), "empty.stl")).rejects.toThrow(/empty/i);
    await expect(prepareCadVaultFile(Buffer.from("hello world, not a CAD file at all"), "notes.txt")).rejects.toThrow(/./);
  });

  it("stores a STEP file without inventing geometry", async () => {
    const step = Buffer.from("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n", "utf8");
    const prepared = await prepareCadVaultFile(step, "bracket.step");
    expect(prepared.format).toBe("step");
    expect(prepared.geometry).toEqual({});
    expect(prepared.thumbnail).toBeNull();
  });
});
