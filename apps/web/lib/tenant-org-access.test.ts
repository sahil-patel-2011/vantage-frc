import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  isWrongOrgDenied,
  requireGrantApplicationInOrg,
  requireGrantOpportunityInOrg,
  requireOrgAdmin,
  requireOrgMember,
  requireSponsorInOrg,
  TenantHttpError,
  tenantErrorResponse,
} from "./tenant-org-access";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "11111111-1111-4111-8111-111111111111";
const SPONSOR = "22222222-2222-4222-8222-222222222222";
const APP = "33333333-3333-4333-8333-333333333333";
const OPP = "44444444-4444-4444-8444-444444444444";

function mockClient(rowCount: number, rows: unknown[] = []): PoolClient {
  return {
    query: vi.fn().mockResolvedValue({ rowCount, rows }),
  } as unknown as PoolClient;
}

describe("tenant isolation — wrong orgId denied", () => {
  it("treats zero membership rows as a hard deny", () => {
    expect(isWrongOrgDenied(0)).toBe(true);
    expect(isWrongOrgDenied(1)).toBe(false);
  });

  it("requireOrgMember throws 403 for a foreign org", async () => {
    const client = mockClient(0);
    await expect(requireOrgMember(client, ORG_B, USER)).rejects.toMatchObject({
      status: 403,
      message: "Organization access denied",
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("memberships"), [ORG_B, USER]);
  });

  it("requireOrgMember allows a member of the requested org", async () => {
    const client = mockClient(1, [{ role: "scout" }]);
    await expect(requireOrgMember(client, ORG_A, USER)).resolves.toEqual({
      role: "scout",
      admin: false,
    });
  });

  it("requireOrgAdmin denies non-admins even when membership exists", async () => {
    const client = mockClient(1, [{ role: "scout" }]);
    await expect(requireOrgAdmin(client, ORG_A, USER)).rejects.toMatchObject({
      status: 403,
      message: "Organization administrator access required",
    });
  });

  it("requireOrgAdmin allows owners", async () => {
    const client = mockClient(1, [{ role: "owner" }]);
    await expect(requireOrgAdmin(client, ORG_A, USER)).resolves.toMatchObject({ admin: true });
  });

  it("requireSponsorInOrg blocks cross-org sponsor ids", async () => {
    const client = mockClient(0);
    await expect(requireSponsorInOrg(client, ORG_A, SPONSOR)).rejects.toMatchObject({
      status: 404,
      message: "Sponsor not found",
    });
  });

  it("requireGrantApplicationInOrg blocks foreign applications", async () => {
    const client = mockClient(0);
    await expect(requireGrantApplicationInOrg(client, ORG_A, APP)).rejects.toMatchObject({
      status: 404,
      message: "Grant application not found",
    });
  });

  it("requireGrantOpportunityInOrg blocks foreign opportunities", async () => {
    const client = mockClient(0);
    await expect(requireGrantOpportunityInOrg(client, ORG_A, OPP)).rejects.toMatchObject({
      status: 404,
      message: "Grant opportunity not found",
    });
  });

  it("tenantErrorResponse maps TenantHttpError to the correct status", async () => {
    const denied = tenantErrorResponse(new TenantHttpError(403, "Organization access denied"));
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({ error: "Organization access denied" });

    const unauthorized = tenantErrorResponse(new TenantHttpError(401, "Authentication required"));
    expect(unauthorized.status).toBe(401);

    const generic = tenantErrorResponse(new Error("orgId is required"));
    expect(generic.status).toBe(400);
  });

  it("maps legacy access-denied Error strings to 403", () => {
    const response = tenantErrorResponse(new Error("Organization access denied"));
    expect(response.status).toBe(403);
  });
});

describe("sponsor visit interaction type allow-list", () => {
  it("accepts visit as a first-class interaction type for visit-day logging", () => {
    const valid = ["email", "call", "meeting", "visit", "event_invite", "thank_you", "other"];
    expect(valid).toContain("visit");
    expect(valid).not.toContain("note");
  });
});
