import { describe, expect, it } from "vitest";
import {
  isAdultRole,
  lookupTeamNumber,
  parseTeamNumber,
  sanitizeTeamNumberInput,
  type TeamLookupInput,
} from "./team-lookup";

const BASE: TeamLookupInput = { raw: "", noTeam: false };

describe("team number parsing", () => {
  it("accepts real FRC team numbers and rejects everything else", () => {
    // Real-format FRC team numbers: 1 (the first number issued) through 99999.
    expect(parseTeamNumber("1")).toBe(1);
    expect(parseTeamNumber("1234")).toBe(1234);
    expect(parseTeamNumber("99999")).toBe(99999);
    expect(parseTeamNumber(" 254 ")).toBe(254);

    expect(parseTeamNumber("")).toBeNull();
    expect(parseTeamNumber("0")).toBeNull();
    expect(parseTeamNumber("100000")).toBeNull();
    expect(parseTeamNumber("12a")).toBeNull();
    expect(parseTeamNumber("12.5")).toBeNull();
    expect(parseTeamNumber("-4")).toBeNull();
    expect(parseTeamNumber("Robo Rangers")).toBeNull();
  });

  it("sanitizes phone-keyboard input to digits, capped at five", () => {
    expect(sanitizeTeamNumberInput("12a34")).toBe("1234");
    expect(sanitizeTeamNumberInput("frc 1234")).toBe("1234");
    expect(sanitizeTeamNumberInput("123456789")).toBe("12345");
    expect(sanitizeTeamNumberInput("")).toBe("");
  });

  it("treats mentors, coaches, and parents as the adults who may claim a team", () => {
    expect(isAdultRole("mentor")).toBe(true);
    expect(isAdultRole("coach")).toBe(true);
    expect(isAdultRole("parent")).toBe(true);
    expect(isAdultRole("student")).toBe(false);
    expect(isAdultRole("other")).toBe(false);
    expect(isAdultRole(null)).toBe(false);
    expect(isAdultRole("student,parent")).toBe(true);
    expect(isAdultRole(["student", "mentor"])).toBe(true);
  });
});

describe("live team-number feedback", () => {
  it("asks for a number when the field is empty, and blocks Continue", () => {
    const result = lookupTeamNumber(BASE);
    expect(result.kind).toBe("incomplete");
    expect(result.ok).toBe(false);
    expect(result.teamNumber).toBeNull();
  });

  it("names what was expected when the shape is wrong", () => {
    const result = lookupTeamNumber({ ...BASE, raw: "Robo Rangers" });
    expect(result.kind).toBe("invalid");
    expect(result.tone).toBe("error");
    expect(result.ok).toBe(false);
    expect(result.body).toMatch(/digits only/i);
    expect(result.body).toMatch(/1–99999/);
  });

  it("lets you finish with no team number at all", () => {
    const result = lookupTeamNumber({ ...BASE, raw: "", noTeam: true });
    expect(result.kind).toBe("no_team");
    expect(result.ok).toBe(true);
    expect(result.body).toMatch(/nothing joins you automatically/i);
  });

  it("never claims a workspace exists from a guess", () => {
    // No server evidence about 1234 — the copy must promise a check, not a result.
    const result = lookupTeamNumber({ ...BASE, raw: "1234" });
    expect(result.kind).toBe("unchecked");
    expect(result.ok).toBe(true);
    expect(result.teamNumber).toBe(1234);
    expect(result.title).toMatch(/requests Team 1234's approval/i);
    expect(result.body).toMatch(/notification/i);
    expect(result.action).toBeNull();
  });

  it("reports the locked workspace the server already bound", () => {
    const result = lookupTeamNumber({
      ...BASE,
      raw: "254",
      locked: true,
      lockedTeamNumber: 254,
      lockedOrgName: "Robo Rangers",
    });
    expect(result.kind).toBe("locked");
    expect(result.tone).toBe("good");
    expect(result.title).toContain("Robo Rangers");
    expect(result.ok).toBe(true);
  });

  it("reflects server-confirmed request states for the same number only", () => {
    const seen = { ...BASE, raw: "1234", knownTeamNumber: 1234 };
    expect(lookupTeamNumber({ ...seen, accessStatus: "pending" }).kind).toBe("requested");
    expect(lookupTeamNumber({ ...seen, accessStatus: "invited" }).kind).toBe("invited");
    expect(lookupTeamNumber({ ...seen, accessStatus: "declined" }).kind).toBe("declined");

    // A different number than the one the server acted on falls back to unchecked.
    expect(
      lookupTeamNumber({ ...BASE, raw: "5678", knownTeamNumber: 1234, accessStatus: "pending" }).kind,
    ).toBe("unchecked");
  });

  it("offers /claim on a server-confirmed empty team only to adults", () => {
    const confirmed = { ...BASE, raw: "9999", knownTeamNumber: 9999, accessStatus: "none" as const };

    const adult = lookupTeamNumber({ ...confirmed, adult: true });
    expect(adult.kind).toBe("no_workspace");
    expect(adult.tone).toBe("warn");
    expect(adult.action).toEqual({ href: "/claim", label: "Claim this team" });

    const student = lookupTeamNumber({ ...confirmed, adult: false });
    expect(student.kind).toBe("no_workspace");
    expect(student.action).toBeNull();
    expect(student.body).toMatch(/ask a mentor or coach/i);
  });

  it("keeps Continue unblocked for every state that is only informational", () => {
    const informational = [
      lookupTeamNumber({ ...BASE, raw: "1234" }),
      lookupTeamNumber({ ...BASE, raw: "", noTeam: true }),
      lookupTeamNumber({ ...BASE, raw: "9999", knownTeamNumber: 9999, accessStatus: "declined" }),
    ];
    expect(informational.every((result) => result.ok)).toBe(true);
  });
});
