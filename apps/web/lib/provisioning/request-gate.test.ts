import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { pendingProvisioningTeam, requestedProvisioningTeam } from "./request-gate";
import { PROVISIONING_PHASES } from "./model";
const org = "e6048770-61f0-48a6-b555-069a1a8d8f03";
describe("setup access boundary", () => {
  it("checks mutation body before the remembered team without consuming the route body", async () => {
    const request = new Request("http://localhost/api/organizations/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId: org }) });
    expect(await requestedProvisioningTeam(request, "6925a000-0000-4000-8000-000000000001")).toBe(org);
    expect((await request.json()).orgId).toBe(org);
  });
  it("retains the selected workspace for malformed bodies", async () => {
    expect(await requestedProvisioningTeam(new Request("http://localhost/api/work", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }), org)).toBe(org);
  });
  it("blocks partial and falsely marked ready jobs while allowing verified and existing teams", async () => {
    const job = { state: "ready", phase: "ready", completedPhases: PROVISIONING_PHASES.map(p => p.id), verifiedAt: "2026-09-26T21:00:00Z", error: null };
    const query = vi.fn();
    const client = { query } as unknown as PoolClient;
    for (const incomplete of [{ ...job, state: "queued" }, { ...job, verifiedAt: null }, { ...job, completedPhases: ["team"] }]) {
      query.mockResolvedValueOnce({ rows: [incomplete] });
      expect(await pendingProvisioningTeam(client, "actor", org)).toBe(org);
    }
    query.mockResolvedValueOnce({ rows: [job] });
    expect(await pendingProvisioningTeam(client, "actor", org)).toBeNull();
    query.mockResolvedValueOnce({ rows: [] });
    expect(await pendingProvisioningTeam(client, "actor", org)).toBeNull();
  });
});
