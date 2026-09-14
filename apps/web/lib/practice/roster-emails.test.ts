import { describe, expect, it } from "vitest";
import { mergePracticeRosterEmails } from "./roster-emails";

describe("mergePracticeRosterEmails", () => {
  it("keeps every existing address when a shorter list arrives", () => {
    expect(
      mergePracticeRosterEmails(
        ["lead@6925.org", "scout@6925.org"],
        ["SCOUT@6925.org", "new@6925.org"],
      ),
    ).toEqual(["lead@6925.org", "scout@6925.org", "new@6925.org"]);
  });

  it("does not drop the first person just because a second person joined", () => {
    const afterFirst = mergePracticeRosterEmails([], ["alpha@example.com"]);
    const afterSecond = mergePracticeRosterEmails(afterFirst, ["beta@example.com"]);
    expect(afterSecond).toEqual(["alpha@example.com", "beta@example.com"]);
  });
});
