import { describe, expect, it } from "vitest";
import { createClaimIntentToken, parseClaimIntentToken } from "@vantage/core";
import { expectPlainCopy } from "../ui/copy-assertions";
import { CLAIM_DENIED_MESSAGE, claimOneAccountCopy, claimSignInHref, slugFromTeamName } from "./claim-flow";

describe("coach claim start", () => {
  it("signs a team-number intent that only this secret can read", () => {
    const token = createClaimIntentToken(6925, "test-secret");
    expect(parseClaimIntentToken(token, "test-secret")).toBe(6925);
    expect(parseClaimIntentToken(token, "other-secret")).toBeNull();
    expect(parseClaimIntentToken("6925.deadbeef", "test-secret")).toBeNull();
  });

  it("keeps coach copy plain and points sign-in back at /claim", () => {
    expectPlainCopy(CLAIM_DENIED_MESSAGE);
    expectPlainCopy(claimOneAccountCopy());
    expect(claimSignInHref()).toBe("/signin?next=%2Fclaim");
    expect(slugFromTeamName("Robo Dogs", 1234)).toBe("robo-dogs");
    expect(slugFromTeamName("!!!", 1234)).toBe("team-1234");
  });
});
