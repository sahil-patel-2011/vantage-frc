import { describe, expect, it } from "vitest";
import { filterMembers, memberAccessLine } from "./people-list";
import { bulkInviteOutcome } from "./team-invites";
import { joinCodeAccessSentence } from "./join-code-flow";

describe("People list (QA A3-21, A3-24)", () => {
  it("names extra powers instead of counting them, in the role words", () => {
    expect(memberAccessLine({ role: "scout", capabilities: ["manage_budget"] })).toBe("Student · Manages money");
    expect(memberAccessLine({ role: "scout", capabilities: ["manage_scouting"] })).toBe("Student · Scouting lead");
    expect(memberAccessLine({ role: "viewer", capabilities: [] })).toBe("Parent or guest");
    expect(memberAccessLine({ role: "admin", capabilities: ["manage_budget"] })).toBe("Mentor or coach · Manages money");
    expect(memberAccessLine({ role: "owner", capabilities: [] })).toBe("Owner");
  });

  it("finds people by name or email and filters by access", () => {
    const people = [
      { name: "Sam Lee", email: "sam@school.org", role: "scout" },
      { name: "Pat Parent", email: "pat@home.test", role: "viewer" },
      { name: "Mo Mentor", email: "mo@school.org", role: "admin" },
    ];
    expect(filterMembers(people, "school", "").map((row) => row.name)).toEqual(["Sam Lee", "Mo Mentor"]);
    expect(filterMembers(people, "", "viewer").map((row) => row.name)).toEqual(["Pat Parent"]);
    expect(filterMembers(people, "PAT", "scout")).toEqual([]);
  });
});

describe("pasted list of invites (QA A3-11)", () => {
  it("keeps the addresses that didn't go in the field, and says why", () => {
    const outcome = bulkInviteOutcome([
      { email: "a@x.test", ok: true, id: "1", inviteUrl: "https://v/invite?token=a", delivery: "resend" },
      { email: "b@x.test", ok: false, error: "Too many invite changes" },
      { email: "c@x.test", ok: false, code: "already_member", error: "C is already on the team as Student." },
    ]);
    expect(outcome.made).toEqual([{ email: "a@x.test", id: "1", url: "https://v/invite?token=a" }]);
    expect(outcome.keep).toEqual(["b@x.test"]);
    expect(outcome.tone).toBe("warn");
    expect(outcome.message).toContain("1 invite ready. We emailed each of them a link.");
    expect(outcome.message).toContain("still in the Email box");
  });

  it("says email is off honestly and empties the field when all went", () => {
    const outcome = bulkInviteOutcome([{ email: "a@x.test", ok: true, id: "1", inviteUrl: "u", delivery: "local" }]);
    expect(outcome.keep).toEqual([]);
    expect(outcome.tone).toBe("ok");
    expect(outcome.message).toMatch(/Email is off here/);
  });
});

describe("join code sentence (QA A3-01)", () => {
  it("says plainly whether the code is on and what joiners get", () => {
    expect(joinCodeAccessSentence({ enabled: false, teamNumber: 9301 })).toMatch(/^Off\. Turn it on/);
    const on = joinCodeAccessSentence({ enabled: true, joinRole: "viewer", teamNumber: 9301 });
    expect(on).toContain("Anyone with team number 9301 and this code can join");
    expect(on).toContain("as Parent or guest (can look, can't change)");
    expect(joinCodeAccessSentence({ enabled: true, joinRole: "scout" })).toContain("as Student.");
  });
});
