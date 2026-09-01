import { describe, expect, it } from "vitest";
import type { TrainingCertification } from "../training/types";
import {
  assertToolCheckoutAllowed,
  certIsCurrent,
  evaluateToolCheckoutGate,
  skillAppliesToTool,
  skillsRequiredForTool,
} from "./training-gate";

const ADA = "11111111-1111-4111-8111-111111111111";
const BOB = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-07-18T00:00:00Z");

const millSkill = { id: "skill-mill", name: "Mill", category: "mill" as const };
const latheSkill = { id: "skill-lathe", name: "Lathe", category: "lathe" as const };
const safetySkill = { id: "skill-safety", name: "Shop safety", category: "safety" as const };

const members = [
  { userId: ADA, name: "Ada Lovelace" },
  { userId: BOB, name: "Bob Martinez" },
];

function cert(overrides: Partial<TrainingCertification> = {}): TrainingCertification {
  return {
    id: "cert-1",
    skillId: millSkill.id,
    skillName: millSkill.name,
    skillCategory: millSkill.category,
    memberUserId: ADA,
    memberName: "Ada Lovelace",
    memberEmail: "ada@example.com",
    certifiedByUserId: BOB,
    certifiedByName: "Bob Martinez",
    certifiedAt: "2026-01-01",
    expiresAt: "2027-01-01",
    notes: null,
    status: "active",
    ...overrides,
  };
}

describe("skillAppliesToTool", () => {
  it("matches a mill skill to a mill-named tool", () => {
    expect(skillAppliesToTool(millSkill, { name: "CNC Mill", category: "power_tool" })).toBe(true);
    expect(skillAppliesToTool(millSkill, { name: "Cordless drill", category: "power_tool" })).toBe(
      false,
    );
  });

  it("matches a safety skill to safety-category gear", () => {
    expect(skillAppliesToTool(safetySkill, { name: "Safety glasses", category: "safety" })).toBe(
      true,
    );
    expect(skillAppliesToTool(safetySkill, { name: "Caliper", category: "measurement" })).toBe(false);
  });
});

describe("evaluateToolCheckoutGate — certified vs uncertified", () => {
  const millTool = { toolName: "Haas mill", toolCategory: "power_tool" as const };

  it("allows checkout when the matrix has no skill for the tool", () => {
    const decision = evaluateToolCheckoutGate({
      ...millTool,
      skills: [latheSkill],
      certifications: [],
      members,
      borrowerName: "Walk-in guest",
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiredSkills).toEqual([]);
  });

  it("allows a certified member to take a gated tool", () => {
    const decision = evaluateToolCheckoutGate({
      ...millTool,
      skills: [millSkill],
      certifications: [cert()],
      members,
      borrowerUserId: ADA,
      borrowerName: "Ada Lovelace",
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.memberUserId).toBe(ADA);
      expect(decision.requiredSkills.map((s) => s.id)).toEqual([millSkill.id]);
    }
  });

  it("refuses an uncertified member when the matrix requires the cert", () => {
    const decision = evaluateToolCheckoutGate({
      ...millTool,
      skills: [millSkill],
      certifications: [cert()],
      members,
      borrowerUserId: BOB,
      borrowerName: "Bob Martinez",
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toMatch(/not certified for Mill/i);
      expect(decision.missingSkills.map((s) => s.id)).toEqual([millSkill.id]);
    }
  });

  it("refuses a member whose only matching cert is expired", () => {
    const decision = evaluateToolCheckoutGate({
      ...millTool,
      skills: [millSkill],
      certifications: [cert({ expiresAt: "2026-01-01", status: "expired" })],
      members,
      borrowerUserId: ADA,
      borrowerName: "Ada Lovelace",
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/not certified/i);
  });

  it("treats expiring-soon as still certified", () => {
    const decision = evaluateToolCheckoutGate({
      ...millTool,
      skills: [millSkill],
      certifications: [cert({ expiresAt: "2026-07-25", status: "expiring_soon" })],
      members,
      borrowerUserId: ADA,
      borrowerName: "Ada Lovelace",
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
  });

  it("resolves an exact roster name when no user id is sent", () => {
    const decision = evaluateToolCheckoutGate({
      ...millTool,
      skills: [millSkill],
      certifications: [cert()],
      members,
      borrowerName: "Ada Lovelace",
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.memberUserId).toBe(ADA);
  });

  it("refuses a gated tool when the borrower is not on the roster", () => {
    const decision = evaluateToolCheckoutGate({
      ...millTool,
      skills: [millSkill],
      certifications: [cert()],
      members,
      borrowerName: "Walk-in guest",
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/roster member/i);
  });

  it("throws the same refusal from the assert helper", () => {
    expect(() =>
      assertToolCheckoutAllowed({
        ...millTool,
        skills: [millSkill],
        certifications: [],
        members,
        borrowerUserId: BOB,
        borrowerName: "Bob Martinez",
        now: NOW,
      }),
    ).toThrow(/not certified for Mill/i);
  });
});

describe("certIsCurrent / skillsRequiredForTool", () => {
  it("uses training certificationStatus so expired dates fail", () => {
    expect(certIsCurrent({ expiresAt: null }, NOW)).toBe(true);
    expect(certIsCurrent({ expiresAt: "2026-01-01" }, NOW)).toBe(false);
    expect(certIsCurrent({ expiresAt: "2026-07-25" }, NOW)).toBe(true);
  });

  it("lists only the skills the matrix applies to the tool", () => {
    const required = skillsRequiredForTool({ name: "South Bend lathe", category: "power_tool" }, [
      millSkill,
      latheSkill,
      safetySkill,
    ]);
    expect(required.map((s) => s.id)).toEqual([latheSkill.id]);
  });
});
