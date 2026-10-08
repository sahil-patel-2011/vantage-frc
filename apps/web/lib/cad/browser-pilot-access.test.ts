import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { browserPilotAccess, loadBrowserPilotAccess, ONSHAPE_BROWSER_PILOT_ORG_ENV } from "./browser-pilot-access";

const orgId = "00000000-0000-4000-8000-000000000001";
const otherOrgId = "00000000-0000-4000-8000-000000000002";

describe("Onshape browser pilot eligibility", () => {
  it("fails closed without a valid server-side pilot binding", () => {
    for (const pilotOrgId of [undefined, "", "6925", "not-an-org"]) {
      expect(browserPilotAccess({ orgId, pilotOrgId, memberTeamNumber: 6925 })).toMatchObject({
        allowed: false, status: "setup_required",
      });
    }
  });

  it("rejects another organization claiming the same team number and a mismatched bound team", () => {
    for (const input of [
      { orgId: otherOrgId, memberTeamNumber: 6925 },
      { orgId, memberTeamNumber: 1111 },
      { orgId, memberTeamNumber: null },
    ]) {
      expect(browserPilotAccess({ ...input, pilotOrgId: orgId })).toMatchObject({ allowed: false, status: "denied" });
    }
  });

  it("permits a current member without requiring a privileged role or exposing membership details", () => {
    expect(browserPilotAccess({ orgId, pilotOrgId: orgId, memberTeamNumber: 6925 })).toEqual({
      allowed: true, status: "eligible", reason: "pilot_member", transport: "onshape_browser_ui",
      message: "Your team membership is eligible for the Onshape browser pilot.",
    });
  });

  it("reads current session membership again after joining and leaving", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ teamNumber: 6925 }] })
      .mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;
    const env = { [ONSHAPE_BROWSER_PILOT_ORG_ENV]: orgId };
    expect((await loadBrowserPilotAccess(client, orgId, env)).allowed).toBe(false);
    expect((await loadBrowserPilotAccess(client, orgId, env)).allowed).toBe(true);
    expect((await loadBrowserPilotAccess(client, orgId, env)).allowed).toBe(false);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("m.user_id = current_app_user_id()"), [orgId]);
  });
});
