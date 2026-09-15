import { describe, expect, it } from "vitest";
import {
  canonicalOnshapeAssemblyUrl,
  classifyVaultDocuments,
  findVaultDocumentForOnshape,
  onshapeUrlIsBoundAssembly,
  vaultCadPlatform,
} from "./vault";

const ONSHAPE_BOUND =
  "https://cad.onshape.com/documents/aaa111bbb222/w/ccc333ddd444/e/eee555fff666";
const ONSHAPE_DOC_ONLY = "https://cad.onshape.com/documents/aaa111bbb222";
const FUSION = "https://a360.co/3AbCdEf";

describe("assembly-manual vault bind helpers", () => {
  it("treats a workspace+element Onshape URL as bound", () => {
    expect(onshapeUrlIsBoundAssembly(ONSHAPE_BOUND)).toBe(true);
    expect(onshapeUrlIsBoundAssembly(ONSHAPE_DOC_ONLY)).toBe(false);
    expect(onshapeUrlIsBoundAssembly(FUSION)).toBe(false);
    expect(canonicalOnshapeAssemblyUrl("aaa111bbb222", "ccc333ddd444", "eee555fff666")).toBe(ONSHAPE_BOUND);
  });

  it("lists Onshape docs for the picker and flags a Fusion-only vault", () => {
    const classified = classifyVaultDocuments([
      { id: "f1", title: "Swerve Fusion", externalUrl: FUSION, seasonYear: 2026 },
      { id: "o1", title: "Intake", externalUrl: ONSHAPE_BOUND, seasonYear: 2026 },
      { id: "o2", title: "Chassis", externalUrl: ONSHAPE_DOC_ONLY, seasonYear: 2025 },
    ]);
    expect(classified.onshape.map((row) => row.id)).toEqual(["o1", "o2"]);
    expect(classified.onshape[0]?.bound).toBe(true);
    expect(classified.onshape[1]?.bound).toBe(false);
    expect(classified.fusionCount).toBe(1);
    expect(classified.fusionOnly).toBe(false);
    expect(vaultCadPlatform(FUSION)).toBe("fusion");
  });

  it("Fusion-only vault cannot feed the book", () => {
    const classified = classifyVaultDocuments([
      { id: "f1", title: "Swerve Fusion", externalUrl: FUSION, seasonYear: 2026 },
    ]);
    expect(classified.onshape).toEqual([]);
    expect(classified.fusionOnly).toBe(true);
  });

  it("finds a vault row for a pasted Onshape document so the bind can stick", () => {
    const classified = classifyVaultDocuments([
      { id: "o1", title: "Intake", externalUrl: ONSHAPE_DOC_ONLY, seasonYear: 2026 },
    ]);
    expect(findVaultDocumentForOnshape(classified.onshape, "aaa111bbb222")?.id).toBe("o1");
    expect(findVaultDocumentForOnshape(classified.onshape, "zzz")).toBeUndefined();
  });
});
