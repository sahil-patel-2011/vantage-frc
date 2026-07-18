import { describe, expect, it } from "vitest";
import {
  CAD_BUILD_RELATED_INCLUDE,
  CAD_COMPETITION_RELATED_INCLUDE,
  cadNextActions,
  formatTopologyEvidence,
  isMockTopologySummary,
} from "./cad-related";

describe("cad Soft-UI helpers", () => {
  it("focuses Build links on Kickoff + FMEA", () => {
    expect(CAD_BUILD_RELATED_INCLUDE).toEqual(["kickoff", "fmea"]);
    expect(CAD_COMPETITION_RELATED_INCLUDE).toEqual(["strategy"]);
  });

  it("labels mock topology as demo — never invents live geometry metrics", () => {
    expect(isMockTopologySummary({ validation: "mock-pass", bodies: 1, features: 3 })).toBe(true);
    expect(isMockTopologySummary({ bodies: 2, features: 4 })).toBe(false);

    expect(
      formatTopologyEvidence({
        topology: { validation: "mock-pass", bodies: 1, features: 2 },
        platform: "mock",
      }),
    ).toBe("Demo / mock checkpoint · not live CAD geometry");

    expect(
      formatTopologyEvidence({
        topology: { bodies: 2, features: 5 },
        platform: "onshape",
      }),
    ).toBe("Topology verified · 2 bodies · 5 features");

    expect(
      formatTopologyEvidence({
        topology: { bodies: 1 },
        humanEditDetected: true,
        platform: "fusion360",
      }),
    ).toBe("Human edit detected · review before resume");
  });

  it("asks for first brief when the queue is empty", () => {
    const actions = cadNextActions({
      orgId: "org-1",
      jobCount: 0,
      onshapeConfigured: true,
      onshapeConnected: true,
      fusionRelayOnline: true,
    });
    expect(actions[0]?.id).toBe("first-brief");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "kickoff")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.every((a) => !/demo geometry/i.test(a.label + a.detail))).toBe(true);
  });

  it("surfaces Onshape OAuth setup_required when env is missing", () => {
    const actions = cadNextActions({
      orgId: "org-1",
      jobCount: 1,
      onshapeConfigured: false,
      onshapeConnected: false,
      fusionRelayOnline: false,
    });
    expect(actions.find((a) => a.id === "onshape-oauth")?.detail).toMatch(/Setup required/i);
    expect(actions.find((a) => a.id === "fusion-relay")?.detail).toMatch(/never hosts/i);
  });

  it("requires workspace when org is missing", () => {
    const actions = cadNextActions({
      jobCount: 0,
      onshapeConfigured: false,
      onshapeConnected: false,
      fusionRelayOnline: false,
    });
    expect(actions).toEqual([
      expect.objectContaining({ id: "workspace", href: "/workspace", primary: true }),
    ]);
  });
});
