import { describe, expect, it } from "vitest";
import { teamJoinInvitePath } from "../onboarding/entry-journey";
import { teamJoinNextStep } from "./join-code-flow";

const TOKEN = "a".repeat(43);
const ORG = "22222222-2222-4222-8222-222222222222";
const options = (signedIn: boolean) => ({ signedIn, validInvitePath: teamJoinInvitePath });

describe("after entering a team code", () => {
  it("sends a signed-out student straight to sign-in for the invitation", () => {
    const next = teamJoinNextStep({ href: `/invite?token=${TOKEN}`, orgName: "Robo Rangers", teamNumber: 6925 }, options(false));
    expect(next).toEqual({ kind: "go", href: `/signin?next=${encodeURIComponent(`/invite?token=${TOKEN}`)}` });
  });

  it("takes a signed-in person to the invitation itself", () => {
    expect(teamJoinNextStep({ href: `/invite?token=${TOKEN}` }, options(true))).toEqual({ kind: "go", href: `/invite?token=${TOKEN}` });
  });

  it("tells someone already on the team so, with Home, instead of a new invitation", () => {
    const next = teamJoinNextStep({ alreadyMember: true, orgId: ORG, orgName: "Robo Rangers", teamNumber: 6925 }, options(true));
    expect(next).toEqual({
      kind: "member",
      member: { orgId: ORG, orgName: "Robo Rangers", teamNumber: 6925, href: `/dashboard?orgId=${ORG}` },
    });
  });

  it("never follows anything but a same-site invitation", () => {
    for (const href of ["https://evil.example/invite?token=x", "/dashboard", "//evil.example", undefined]) {
      expect(teamJoinNextStep({ href }, options(false))).toEqual({ kind: "error" });
    }
    expect(teamJoinNextStep({ alreadyMember: true, orgId: "../../admin" }, options(true))).toEqual({ kind: "error" });
  });
});
