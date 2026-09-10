import { describe, expect, it } from "vitest";
import {
  buildOrgSessionContextItem,
  formatOrgSessionContext,
} from "../src/org-session-context";

describe("org session context", () => {
  it("formats only real fields and skips empties", () => {
    const text = formatOrgSessionContext({
      orgName: "Vantage Robotics",
      teamNumber: 1111,
      activeEventKey: "2026nyli",
      seasonYear: 2026,
      teamAffiliation: "public_school",
      schoolFunded: true,
      sponsorsAllowed: false,
      privacyScope: "team",
      capability: "chat",
    });
    expect(text).toContain("Organization: Vantage Robotics");
    expect(text).toContain("FRC team number: 1111");
    expect(text).toContain("Active event: 2026nyli");
    expect(text).toContain("Season year: 2026");
    expect(text).toContain("School-funded: yes");
    expect(text).toContain("Sponsors tools allowed: no");
    expect(text).not.toMatch(/DEMO/i);
  });

  it("lists vault documents by title and whether they are a link or an upload", () => {
    const text = formatOrgSessionContext({
      orgName: "Team",
      teamNumber: 6925,
      activeEventKey: null,
      seasonYear: null,
      teamAffiliation: null,
      schoolFunded: null,
      sponsorsAllowed: null,
      cadVault: [
        { title: "Intake assembly", kind: "assembly", externalUrl: "https://cad.onshape.com/documents/abc", hasUpload: false },
        { title: "Bracket v3", kind: "part", externalUrl: null, hasUpload: true },
      ],
    });
    expect(text).toContain("Intake assembly");
    expect(text).toContain("https://cad.onshape.com/documents/abc");
    expect(text).toContain("Bracket v3");
    expect(text).toContain("uploaded file");
    expect(text).not.toMatch(/\bkg\b/i);
  });

  it("returns null when nothing real is present", () => {
    expect(
      formatOrgSessionContext({
        orgName: null,
        teamNumber: null,
        activeEventKey: null,
        seasonYear: null,
        teamAffiliation: null,
        schoolFunded: null,
        sponsorsAllowed: null,
      }),
    ).toBeNull();
    expect(
      buildOrgSessionContextItem({
        orgName: null,
        teamNumber: null,
        activeEventKey: null,
        seasonYear: null,
        teamAffiliation: null,
        schoolFunded: null,
        sponsorsAllowed: null,
      }),
    ).toBeNull();
  });

  it("builds a high-importance module_data context item", () => {
    const item = buildOrgSessionContextItem({
      orgName: "Team",
      teamNumber: 254,
      activeEventKey: null,
      seasonYear: null,
      teamAffiliation: null,
      schoolFunded: null,
      sponsorsAllowed: null,
    });
    expect(item).toMatchObject({
      type: "module_data",
      id: "org-session",
      importance: 950,
      classification: "hard_metric",
    });
    expect(item!.content).toContain("FRC team number: 254");
  });
});
