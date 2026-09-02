import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeOnboardingBuddyView, createPairing } from "./compute-onboarding-buddy";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const NEW_MEMBER = "22222222-2222-4222-8222-222222222222";
const BUDDY = "33333333-3333-4333-8333-333333333333";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeOnboardingBuddyView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships m")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeOnboardingBuddyView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.steps.map((s) => s.id)).toEqual(
        expect.arrayContaining(["workspace", "onboarding", "team-data"]),
      );
      expect(view.steps.find((s) => s.id === "workspace")?.href).toBe("/workspace");
      expect(view.steps.every((s) => !/demo/i.test(s.href))).toBe(true);
    }
  });

  it("returns a live view identifying unpaired recent joiners and a suggested buddy", async () => {
    const now = new Date();
    const recentJoin = new Date(now.getTime() - 3 * 86_400_000).toISOString();
    const oldJoin = new Date(now.getTime() - 400 * 86_400_000).toISOString();

    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships m") && sql.includes("JOIN organizations")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM memberships m") && sql.includes("JOIN users u")) {
        return {
          rows: [
            { userId: BUDDY, name: "Grace", role: "member", joinedAt: oldJoin },
            { userId: NEW_MEMBER, name: "Ada", role: "member", joinedAt: recentJoin },
          ],
        };
      }
      if (sql.includes("FROM onboarding_buddy_pairings p")) return { rows: [] };
      if (sql.includes("FROM onboarding_buddy_plan_items")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeOnboardingBuddyView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.members).toHaveLength(2);
    expect(view.unpairedMembers.map((m) => m.userId)).toEqual([NEW_MEMBER]);
    expect(view.suggestedBuddyByMember[NEW_MEMBER]?.userId).toBe(BUDDY);
    expect(view.summary.unpairedCount).toBe(1);
    expect(view.summary.activePairingCount).toBe(0);
  });
});

describe("createPairing", () => {
  it("inserts a pairing, meters the deterministic plan synthesis, and writes plan items", async () => {
    const inserts: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("INSERT INTO onboarding_buddy_pairings")) {
        inserts.push({ sql, params });
        return { rows: [{ id: "pairing-1" }] };
      }
      if ((sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserts.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO onboarding_buddy_plan_items")) {
        inserts.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    const { pairingId } = await createPairing(client, {
      orgId: ORG,
      userId: USER,
      newMemberId: NEW_MEMBER,
      buddyId: BUDDY,
      notes: null,
    });

    expect(pairingId).toBe("pairing-1");
    const usageInsert = inserts.find((entry) => (entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts")));
    expect(usageInsert).toBeDefined();
    const planInserts = inserts.filter((entry) => entry.sql.includes("INSERT INTO onboarding_buddy_plan_items"));
    expect(planInserts.length).toBeGreaterThan(0);
  });
});
