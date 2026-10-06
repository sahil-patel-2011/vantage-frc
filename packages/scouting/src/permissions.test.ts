import { describe, expect, it, vi } from "vitest";
import { assertScoutingLead, canManageScouting } from "./permissions";
describe("delegated scouting authorization", () => {
  it("uses the organization capability contract, including delegated leads", async () => {
    const query=vi.fn().mockResolvedValue({rows:[{allowed:true}]});
    expect(await canManageScouting({query} as never,"team-a")).toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("'manage_scouting'::org_capability"),["team-a"]);
  });
  it("fails closed for missing membership, revocation and a negative grant", async () => {
    for (const rows of [[],[{allowed:false}],[{allowed:"true"}]]) await expect(assertScoutingLead({query:vi.fn().mockResolvedValue({rows})} as never,"team-b")).rejects.toMatchObject({status:403});
  });
});
