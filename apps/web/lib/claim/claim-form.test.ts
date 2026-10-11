import { describe, expect, it } from "vitest";
import { EMPTY_CLAIM_FIELDS, claimNameToSubmit, claimPrefill, claimSlugToSubmit, withClaimTeamNumber } from "./claim-form";

describe("/claim form fields", () => {
  it("starts blank without an explicit team number", () => {
    expect(claimPrefill(null, [6925])).toEqual(EMPTY_CLAIM_FIELDS);
    expect(claimPrefill("", [])).toEqual(EMPTY_CLAIM_FIELDS);
  });

  it("prefills only a valid ?teamNumber= that is not one of the person's own teams", () => {
    expect(claimPrefill("1678", [6925])).toEqual({ teamNumber: "1678", name: "Team 1678", slug: "team-1678" });
    // Their current team already has a workspace: claiming it could only fail.
    expect(claimPrefill("6925", [6925, null])).toEqual(EMPTY_CLAIM_FIELDS);
    for (const bad of ["0", "123456", "12a", "-4", "frc254"]) expect(claimPrefill(bad, [])).toEqual(EMPTY_CLAIM_FIELDS);
  });

  it("lets the name and web address follow the number until the person types their own", () => {
    let fields = withClaimTeamNumber(EMPTY_CLAIM_FIELDS, "16");
    fields = withClaimTeamNumber(fields, "167");
    fields = withClaimTeamNumber(fields, "1678");
    expect(fields).toEqual({ teamNumber: "1678", name: "Team 1678", slug: "team-1678" });

    const named = withClaimTeamNumber({ ...fields, name: "Citrus Circuits" }, "1679");
    expect(named).toEqual({ teamNumber: "1679", name: "Citrus Circuits", slug: "team-1679" });

    // Clearing the name hands it back to the number.
    expect(withClaimTeamNumber({ ...named, name: "" }, "254").name).toBe("Team 254");
    expect(withClaimTeamNumber(EMPTY_CLAIM_FIELDS, "12ab34567").teamNumber).toBe("12345");
  });

  it("sends Team NNNN when the name is left blank, as its placeholder says", () => {
    expect(claimNameToSubmit({ teamNumber: "118", name: "  ", slug: "team-118" })).toBe("Team 118");
    expect(claimNameToSubmit({ teamNumber: "118", name: " Robonauts ", slug: "team-118" })).toBe("Robonauts");
  });

  it("uses the same team-NNNN address as teams a platform admin adds", () => {
    expect(claimSlugToSubmit({ teamNumber: "6925", name: "x", slug: "" })).toBe("team-6925");
    expect(claimSlugToSubmit(withClaimTeamNumber(EMPTY_CLAIM_FIELDS, "6925"))).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});
