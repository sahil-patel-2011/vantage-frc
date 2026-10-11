import { describe, expect, it } from "vitest";
import { inviteSuggestionCopy, suggestionSentMessage, teamLeadsLine } from "./invite-suggestion";

describe("asking the owner to invite someone (QA A3-04)", () => {
  it("says who will see it", () => {
    expect(teamLeadsLine(["Quinn Owner"])).toBe("It goes to Quinn Owner.");
    expect(teamLeadsLine(["Quinn", "Mo"])).toBe("It goes to Quinn and Mo.");
    expect(teamLeadsLine(["A", "B", "C", "D", "E"])).toBe("It goes to A, B and 3 others who run the team.");
    expect(teamLeadsLine([])).toBe("");
  });

  it("confirms what happens next", () => {
    expect(suggestionSentMessage("lee@school.org", 2)).toBe(
      "Sent. 2 people who run your team got a notice to invite lee@school.org. They send the invite; you don't need to do anything else.",
    );
  });

  it("gives the owner a one-tap invite with the access in role words", () => {
    const copy = inviteSuggestionCopy({ fromName: "Sam", email: "lee@school.org", suggestedRole: "viewer" }, "org-1");
    expect(copy.title).toBe("Sam asks you to invite lee@school.org");
    expect(copy.body).toBe("As Parent or guest. Open Team admin to send the invite.");
    expect(copy.href).toBe("/team/admin?orgId=org-1&invite=1&email=lee%40school.org&role=viewer#invite");
    // An unknown access is never put into the link.
    expect(inviteSuggestionCopy({ email: "x@y.z", suggestedRole: "owner" }, null).href).not.toContain("role=");
  });
});
