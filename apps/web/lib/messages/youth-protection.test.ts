import { describe, expect, it } from "vitest";
import {
  DEFAULT_DM_MODE,
  DM_MODE_COPY,
  classifyTeamRole,
  decideDm,
  isAdultTeamRole,
  normalizeDmMode,
  pairNeedsSecondAdult,
  pickSupervisor,
  supervisionBadge,
  type SupervisorCandidate,
} from "./youth-protection";

const owner: SupervisorCandidate = {
  userId: "u-owner",
  name: "Dana Coach",
  memberRole: "owner",
  memberSince: "2024-01-01T00:00:00Z",
};
const adminEarly: SupervisorCandidate = {
  userId: "u-admin-early",
  name: "Ali Mentor",
  memberRole: "admin",
  memberSince: "2023-06-01T00:00:00Z",
};
const adminLate: SupervisorCandidate = {
  userId: "u-admin-late",
  name: "Bo Parent",
  memberRole: "admin",
  memberSince: "2025-02-01T00:00:00Z",
};

describe("adult classification", () => {
  it("treats mentor, coach and parent as adults", () => {
    expect(isAdultTeamRole("mentor")).toBe(true);
    expect(isAdultTeamRole("coach")).toBe(true);
    expect(isAdultTeamRole("PARENT")).toBe(true);
  });

  it("treats student, other, and an unset role as youth", () => {
    expect(isAdultTeamRole("student")).toBe(false);
    expect(isAdultTeamRole("other")).toBe(false);
    expect(isAdultTeamRole(null)).toBe(false);
    expect(isAdultTeamRole(undefined)).toBe(false);
    expect(classifyTeamRole("")).toBe("youth");
    expect(isAdultTeamRole("mentor,coach")).toBe(true);
    expect(isAdultTeamRole("student,parent")).toBe(false);
  });

  it("only flags mixed pairs", () => {
    expect(pairNeedsSecondAdult("adult", "youth")).toBe(true);
    expect(pairNeedsSecondAdult("youth", "adult")).toBe(true);
    expect(pairNeedsSecondAdult("youth", "youth")).toBe(false);
    expect(pairNeedsSecondAdult("adult", "adult")).toBe(false);
  });
});

describe("dm mode", () => {
  it("defaults to supervised for anything unrecognised", () => {
    expect(DEFAULT_DM_MODE).toBe("supervised");
    expect(normalizeDmMode(undefined)).toBe("supervised");
    expect(normalizeDmMode("nonsense")).toBe("supervised");
    expect(normalizeDmMode(" OPEN ")).toBe("open");
    expect(normalizeDmMode("disabled")).toBe("disabled");
  });

  it("states plainly what open mode means", () => {
    expect(DM_MODE_COPY.open.detail).toContain("no second adult");
  });
});

describe("pickSupervisor", () => {
  it("prefers an owner, then the longest-standing admin, deterministically", () => {
    expect(pickSupervisor([adminLate, adminEarly, owner], [])?.userId).toBe("u-owner");
    expect(pickSupervisor([adminLate, adminEarly], [])?.userId).toBe("u-admin-early");
  });

  it("never picks someone who is in the conversation", () => {
    expect(pickSupervisor([owner, adminEarly], ["u-owner"])?.userId).toBe("u-admin-early");
    expect(pickSupervisor([owner], ["u-owner"])).toBeNull();
  });

  it("breaks ties on user id so repeated calls agree", () => {
    const a = { userId: "a", name: "A", memberRole: "admin", memberSince: "2024-01-01T00:00:00Z" };
    const b = { userId: "b", name: "B", memberRole: "admin", memberSince: "2024-01-01T00:00:00Z" };
    expect(pickSupervisor([b, a], [])?.userId).toBe("a");
    expect(pickSupervisor([a, b], [])?.userId).toBe("a");
  });
});

describe("decideDm", () => {
  const base = { candidates: [owner, adminEarly], partyUserIds: ["u-mentor", "u-student"] };

  it("leaves youth-to-youth and adult-to-adult alone in every mode", () => {
    for (const mode of ["open", "supervised", "disabled"] as const) {
      expect(decideDm({ ...base, mode, initiatorClass: "youth", peerClass: "youth" }).outcome).toBe(
        "allow",
      );
      expect(decideDm({ ...base, mode, initiatorClass: "adult", peerClass: "adult" }).outcome).toBe(
        "allow",
      );
    }
  });

  it("supervises a mixed pair by default", () => {
    const decision = decideDm({
      ...base,
      mode: "supervised",
      initiatorClass: "adult",
      peerClass: "youth",
    });
    expect(decision.outcome).toBe("supervise");
    expect(decision.supervisor?.userId).toBe("u-owner");
  });

  it("refuses a mixed pair when the team has no other adult admin", () => {
    const decision = decideDm({
      mode: "supervised",
      initiatorClass: "adult",
      peerClass: "youth",
      candidates: [owner],
      partyUserIds: ["u-owner", "u-student"],
    });
    expect(decision.outcome).toBe("refuse");
    if (decision.outcome !== "refuse") throw new Error("expected refusal");
    expect(decision.message).toContain("second adult");
  });

  it("does not re-add a supervisor to a conversation that already has one", () => {
    const decision = decideDm({
      ...base,
      mode: "supervised",
      initiatorClass: "youth",
      peerClass: "adult",
      existingSupervisorIds: ["u-admin-early"],
    });
    expect(decision.outcome).toBe("allow");
  });

  it("refuses a mixed pair outright when DMs are disabled, naming the policy", () => {
    const decision = decideDm({
      ...base,
      mode: "disabled",
      initiatorClass: "adult",
      peerClass: "youth",
    });
    expect(decision.outcome).toBe("refuse");
    if (decision.outcome !== "refuse") throw new Error("expected refusal");
    expect(decision.message).toContain("chat policy");
  });

  it("allows a mixed pair unsupervised only in open mode", () => {
    const decision = decideDm({
      ...base,
      mode: "open",
      initiatorClass: "adult",
      peerClass: "youth",
    });
    expect(decision.outcome).toBe("allow");
    expect(decision.supervisor).toBeNull();
  });
});

describe("supervisionBadge", () => {
  it("names who else is in the room", () => {
    expect(supervisionBadge(["Dana Coach"])).toContain("Dana Coach can read this conversation");
    expect(supervisionBadge(["Dana Coach", "Ali Mentor"])).toContain("Dana Coach and Ali Mentor");
    expect(supervisionBadge([])).toBe("");
  });
});
