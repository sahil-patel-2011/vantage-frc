import { describe, expect, it } from "vitest";
import { certificationStatus, computeExpiryDate, summarizeTraining } from "./index";
import { computeTrainingView } from "./compute-training";
import type { TrainingCertification } from "./types";

let seq = 0;
function cert(overrides: Partial<TrainingCertification> = {}): TrainingCertification {
  seq += 1;
  return {
    id: `cert-${seq}`,
    skillId: "skill-mill",
    skillName: "Mill",
    skillCategory: "mill",
    memberUserId: "user-1",
    memberName: "Ada Lovelace",
    memberEmail: "ada@example.com",
    certifiedByUserId: "user-2",
    certifiedByName: "Grace Hopper",
    certifiedAt: "2026-01-01",
    expiresAt: null,
    notes: null,
    status: "active",
    ...overrides,
  };
}

// Minimal PoolClient stub: only `query` is called by computeTrainingView.
function mockClient(responses: unknown[][]) {
  let call = 0;
  return {
    query: async () => {
      const rows = responses[call] ?? [];
      call += 1;
      return { rows, rowCount: rows.length };
    },
  } as unknown as import("@neondatabase/serverless").PoolClient;
}

describe("certificationStatus", () => {
  it("is active when there is no expiry", () => {
    expect(certificationStatus(null)).toBe("active");
  });

  it("is expired once the expiry date has passed", () => {
    expect(certificationStatus("2026-01-01", new Date("2026-02-01T00:00:00Z"))).toBe("expired");
  });

  it("is expiring_soon within the warning window", () => {
    expect(certificationStatus("2026-01-15", new Date("2026-01-01T00:00:00Z"))).toBe("expiring_soon");
  });

  it("is active well before expiry", () => {
    expect(certificationStatus("2026-12-31", new Date("2026-01-01T00:00:00Z"))).toBe("active");
  });
});

describe("computeExpiryDate", () => {
  it("returns null when there is no validity window", () => {
    expect(computeExpiryDate("2026-01-01", null)).toBeNull();
    expect(computeExpiryDate("2026-01-01", 0)).toBeNull();
  });

  it("adds the validity window in months", () => {
    expect(computeExpiryDate("2026-01-15", 12)).toBe("2027-01-15");
  });
});

describe("summarizeTraining", () => {
  it("returns an all-zero summary for no certifications", () => {
    const s = summarizeTraining([], 0);
    expect(s.totalCertifications).toBe(0);
    expect(s.certifiedMemberCount).toBe(0);
    expect(s.coverageSignal).toBe(0);
    expect(s.bySkill).toEqual([]);
    expect(s.byMember).toEqual([]);
  });

  it("tallies active / expiring / expired and per-skill, per-member breakdowns", () => {
    const certs = [
      cert({ status: "active", skillId: "s1", skillName: "Mill", memberUserId: "u1", memberName: "A" }),
      cert({ status: "expiring_soon", skillId: "s1", skillName: "Mill", memberUserId: "u2", memberName: "B" }),
      cert({ status: "expired", skillId: "s2", skillName: "Lathe", memberUserId: "u1", memberName: "A" }),
    ];
    const s = summarizeTraining(certs, 2);
    expect(s.totalCertifications).toBe(3);
    expect(s.certifiedMemberCount).toBe(2);
    expect(s.activeCount).toBe(1);
    expect(s.expiringSoonCount).toBe(1);
    expect(s.expiredCount).toBe(1);
    const mill = s.bySkill.find((row) => row.skillId === "s1");
    expect(mill?.activeCount).toBe(1);
    expect(mill?.expiringSoonCount).toBe(1);
    const memberA = s.byMember.find((row) => row.memberUserId === "u1");
    expect(memberA?.activeSkillCount).toBe(1);
    expect(memberA?.expiredCount).toBe(1);
    expect(s.coverageSignal).toBeGreaterThan(0);
    expect(s.coverageSignal).toBeLessThanOrEqual(1);
  });
});

describe("computeTrainingView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient([[]]); // resolveOrg membership query -> no rows
    const view = await computeTrainingView(client, { userId: "user-1", requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with summarized coverage over mock rows", async () => {
    const now = new Date("2026-07-18T00:00:00Z");
    const client = mockClient([
      [{ orgId: "org-1", teamNumber: 254, role: "admin" }], // resolveOrg
      [
        {
          id: "skill-1",
          name: "Mill",
          category: "mill",
          description: null,
          validityMonths: 12,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ], // skills
      [
        {
          id: "cert-1",
          skillId: "skill-1",
          skillName: "Mill",
          skillCategory: "mill",
          memberUserId: "user-1",
          memberName: "Ada Lovelace",
          memberEmail: "ada@example.com",
          certifiedByUserId: "user-2",
          certifiedByName: "Grace Hopper",
          certifiedAt: "2026-01-01",
          expiresAt: "2027-01-01",
          notes: null,
        },
      ], // certifications
      [
        { userId: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
        { userId: "user-2", name: "Grace Hopper", email: "grace@example.com" },
      ], // members
    ]);

    const view = await computeTrainingView(client, { userId: "user-1", requestedOrg: "org-1", now });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe("org-1");
      expect(view.teamNumber).toBe(254);
      expect(view.skills).toHaveLength(1);
      expect(view.certifications).toHaveLength(1);
      expect(view.certifications[0]?.status).toBe("active");
      expect(view.summary.totalCertifications).toBe(1);
      expect(view.summary.certifiedMemberCount).toBe(1);
      expect(view.members).toHaveLength(2);
      expect(view.canManage).toBe(true);
    }
  });

  it("marks a scout as read-only so the matrix renders without write controls", async () => {
    const client = mockClient([[{ orgId: "org-1", teamNumber: 254, role: "scout" }], [], [], []]);
    const view = await computeTrainingView(client, { userId: "user-9", requestedOrg: "org-1" });
    expect(view.status).toBe("live");
    if (view.status === "live") expect(view.canManage).toBe(false);
  });
});
