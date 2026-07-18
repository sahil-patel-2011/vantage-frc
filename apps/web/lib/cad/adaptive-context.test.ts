import { describe, expect, it } from "vitest";
import { parseCadTeamProfile, parseCadUserPreferences } from "./adaptive-context";

describe("adaptive CAD context", () => {
  it("bounds and deduplicates team manufacturing knowledge", () => {
    const profile = parseCadTeamProfile({
      defaultPlatform: "fusion360",
      preferredUnits: "in",
      manufacturingProcesses: "CNC router\n3D printing\nCNC router",
      preferredMaterials: ["6061 aluminum", "polycarbonate"],
    });
    expect(profile).toMatchObject({
      defaultPlatform: "fusion360",
      preferredUnits: "in",
      manufacturingProcesses: ["CNC router", "3D printing"],
    });
  });

  it("keeps one user's custom response preference bounded", () => {
    const preference = parseCadUserPreferences({
      responseStyle: "expert",
      explanationDepth: "deep",
      preferredUnits: "mm",
      preferredPlatform: "onshape",
      customInstructions: "Lead with API limitations.",
    });
    expect(preference).toEqual({
      responseStyle: "expert",
      explanationDepth: "deep",
      preferredUnits: "mm",
      preferredPlatform: "onshape",
      customInstructions: "Lead with API limitations.",
    });
  });
});
