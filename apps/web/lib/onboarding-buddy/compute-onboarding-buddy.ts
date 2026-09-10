import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import {
  buildFirstWeekPlanItems,
  daysBetween,
  findUnpairedMembers,
  planProgress,
  suggestBuddy,
  summarizeOnboardingBuddy,
} from ".";
import {
  onboardingBuddySetupSteps,
  type OnboardingBuddySetupStep,
} from "./onboarding-buddy-related";
import {
  assertRosterMembers,
  pairingInsertParams,
  parseCreatePairingInput,
} from "./roster";
import type {
  OnboardingBuddyMember,
  OnboardingBuddyPairing,
  OnboardingBuddyPairingStatus,
  OnboardingBuddyPlanItem,
  OnboardingBuddySummary,
} from "./types";

export type { OnboardingBuddySetupStep };

export type OnboardingBuddyView =
  | {
      status: "setup_required";
      message: string;
      steps: OnboardingBuddySetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      members: OnboardingBuddyMember[];
      unpairedMembers: OnboardingBuddyMember[];
      suggestedBuddyByMember: Record<string, OnboardingBuddyMember | null>;
      pairings: OnboardingBuddyPairing[];
      summary: OnboardingBuddySummary;
      computedAt: string;
    };

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

type MemberRow = {
  userId: string;
  name: string;
  role: string;
  joinedAt: string;
};

async function loadMembers(client: PoolClient, orgId: string, nowIso: string): Promise<OnboardingBuddyMember[]> {
  const result = await client.query<MemberRow>(
    `SELECT m.user_id::text AS "userId", COALESCE(NULLIF(trim(u.name),''), u.email) AS name,
            m.role::text AS role, m.created_at::text AS "joinedAt"
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1
     ORDER BY m.created_at ASC`,
    [orgId],
  );
  return result.rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    role: row.role,
    joinedAt: row.joinedAt,
    tenureDays: daysBetween(row.joinedAt, nowIso),
  }));
}

type PairingRow = {
  id: string;
  newMemberId: string;
  newMemberName: string;
  buddyId: string;
  buddyName: string;
  status: OnboardingBuddyPairingStatus;
  notes: string | null;
  pairedAt: string;
  completedAt: string | null;
};

type PlanItemRow = {
  id: string;
  pairingId: string;
  dayOffset: number;
  sequence: number;
  title: string;
  description: string | null;
  done: boolean;
  doneAt: string | null;
};

async function loadPairings(client: PoolClient, orgId: string): Promise<OnboardingBuddyPairing[]> {
  const [pairingResult, planResult] = await Promise.all([
    client.query<PairingRow>(
      `SELECT p.id, p.new_member_id::text AS "newMemberId",
              COALESCE(NULLIF(trim(nu.name),''), nu.email) AS "newMemberName",
              p.buddy_id::text AS "buddyId",
              COALESCE(NULLIF(trim(bu.name),''), bu.email) AS "buddyName",
              p.status, p.notes, p.paired_at::text AS "pairedAt", p.completed_at::text AS "completedAt"
       FROM onboarding_buddy_pairings p
       JOIN memberships nm ON nm.org_id = p.org_id AND nm.user_id = p.new_member_id
       JOIN memberships bm ON bm.org_id = p.org_id AND bm.user_id = p.buddy_id
       JOIN users nu ON nu.id = p.new_member_id
       JOIN users bu ON bu.id = p.buddy_id
       WHERE p.org_id = $1::uuid
       ORDER BY p.paired_at DESC`,
      [orgId],
    ),
    client.query<PlanItemRow>(
      `SELECT id, pairing_id AS "pairingId", day_offset AS "dayOffset", sequence, title, description,
              done, done_at::text AS "doneAt"
       FROM onboarding_buddy_plan_items
       WHERE org_id = $1
       ORDER BY day_offset ASC, sequence ASC`,
      [orgId],
    ),
  ]);

  const itemsByPairing = new Map<string, OnboardingBuddyPlanItem[]>();
  for (const row of planResult.rows) {
    const item: OnboardingBuddyPlanItem = {
      id: row.id,
      pairingId: row.pairingId,
      dayOffset: Number(row.dayOffset) || 0,
      sequence: Number(row.sequence) || 0,
      title: row.title,
      description: row.description,
      done: Boolean(row.done),
      doneAt: row.doneAt,
    };
    const list = itemsByPairing.get(row.pairingId) ?? [];
    list.push(item);
    itemsByPairing.set(row.pairingId, list);
  }

  return pairingResult.rows.map((row) => {
    const planItems = itemsByPairing.get(row.id) ?? [];
    return {
      id: row.id,
      newMemberId: row.newMemberId,
      newMemberName: row.newMemberName,
      buddyId: row.buddyId,
      buddyName: row.buddyName,
      status: row.status,
      notes: row.notes,
      pairedAt: row.pairedAt,
      completedAt: row.completedAt,
      planItems,
      planProgress: planProgress(planItems),
    };
  });
}

export async function computeOnboardingBuddyView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<OnboardingBuddyView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to pair new members with a buddy.",
      steps: onboardingBuddySetupSteps(null),
      orgId: null,
    };
  }

  const nowIso = new Date().toISOString();
  const [members, pairings] = await Promise.all([
    loadMembers(client, org.orgId, nowIso),
    loadPairings(client, org.orgId),
  ]);

  const activePairedNewMemberIds = new Set(pairings.filter((p) => p.status === "active").map((p) => p.newMemberId));
  const unpairedMembers = findUnpairedMembers(members, activePairedNewMemberIds, nowIso);

  const activeBuddyCounts: Record<string, number> = {};
  for (const p of pairings) {
    if (p.status !== "active") continue;
    activeBuddyCounts[p.buddyId] = (activeBuddyCounts[p.buddyId] ?? 0) + 1;
  }

  const suggestedBuddyByMember: Record<string, OnboardingBuddyMember | null> = {};
  for (const member of unpairedMembers) {
    suggestedBuddyByMember[member.userId] = suggestBuddy(members, member.userId, activeBuddyCounts);
  }

  const summary = summarizeOnboardingBuddy(members, unpairedMembers.length, pairings);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    members,
    unpairedMembers,
    suggestedBuddyByMember,
    pairings,
    summary,
    computedAt: nowIso,
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/** Creates a pairing and generates the metered, deterministic first-week plan for it. */
export async function createPairing(
  client: PoolClient,
  input: { orgId: string; userId: string; newMemberId: string; buddyId: string; notes: string | null },
): Promise<string> {
  const pair = parseCreatePairingInput(input);
  await assertRosterMembers(client, input.orgId, [pair.newMemberId, pair.buddyId]);
  const result = await client.query<{ id: string }>(
    `INSERT INTO onboarding_buddy_pairings (org_id, new_member_id, buddy_id, notes, created_by)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid) RETURNING id`,
    pairingInsertParams({
      orgId: input.orgId,
      newMemberId: pair.newMemberId,
      buddyId: pair.buddyId,
      notes: pair.notes,
      createdBy: input.userId,
    }),
  );
  const pairingId = result.rows[0]!.id;

  const draftItems = buildFirstWeekPlanItems();
  const metered = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "onboarding_buddy",
    requestId: `onboarding-buddy-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      pairingId,
      note: "Deterministic first-week onboarding plan synthesis — no external model call",
    },
    invoke: async () => ({
      value: JSON.stringify(draftItems),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-onboarding-buddy-v1",
      provider: "vantage-local",
    }),
  });
  const plannedItems = JSON.parse(metered) as typeof draftItems;

  for (const item of plannedItems) {
    await client.query(
      `INSERT INTO onboarding_buddy_plan_items (org_id, pairing_id, day_offset, sequence, title, description)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [input.orgId, pairingId, item.dayOffset, item.sequence, item.title, item.description],
    );
  }

  return pairingId;
}

export async function togglePlanItem(
  client: PoolClient,
  input: { orgId: string; itemId: string; done: boolean },
): Promise<void> {
  await client.query(
    `UPDATE onboarding_buddy_plan_items SET done = $3, done_at = CASE WHEN $3 THEN now() ELSE NULL END
     WHERE id = $1 AND org_id = $2`,
    [input.itemId, input.orgId, input.done],
  );
}

export async function setPairingStatus(
  client: PoolClient,
  input: { orgId: string; pairingId: string; status: OnboardingBuddyPairingStatus },
): Promise<void> {
  await client.query(
    `UPDATE onboarding_buddy_pairings
     SET status = $3, completed_at = CASE WHEN $3 = 'active' THEN NULL ELSE now() END
     WHERE id = $1 AND org_id = $2`,
    [input.pairingId, input.orgId, input.status],
  );
}

export async function deletePairing(client: PoolClient, input: { orgId: string; pairingId: string }): Promise<void> {
  await client.query(`DELETE FROM onboarding_buddy_pairings WHERE id = $1 AND org_id = $2`, [
    input.pairingId,
    input.orgId,
  ]);
}
