import { describe, expect, it } from "vitest";
import { assertTeamHandover } from "./team-handover";

describe("team handover authorization", () => {
  const valid = { actorRole: "owner", actorUserId: "starter", userId: "lead", recipientRole: "admin", recipientVerified: true, nextRole: "scout" };
  it("lets a starter appoint an accepted lead and step down", () => expect(() => assertTeamHandover(valid)).not.toThrow());
  it.each(["admin", "scout", "viewer", "mentor", null])("refuses a self-claimed or non-owner role %s", actorRole => {
    expect(() => assertTeamHandover({ ...valid, actorRole })).toThrow(/Only an owner/);
  });
  it("requires a joined, verified teammate", () => {
    expect(() => assertTeamHandover({ ...valid, recipientRole: null })).toThrow(/join/);
    expect(() => assertTeamHandover({ ...valid, recipientVerified: false })).toThrow(/verify/);
  });
  it("refuses self-transfer and invalid next privileges", () => {
    expect(() => assertTeamHandover({ ...valid, userId: "starter" })).toThrow(/another/);
    expect(() => assertTeamHandover({ ...valid, nextRole: "owner" })).toThrow(/new access/);
  });
});
