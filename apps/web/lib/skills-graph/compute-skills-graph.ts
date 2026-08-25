import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { PROFICIENCY_LEVELS, SKILL_CATEGORIES, rankMentorCandidates } from ".";
import { roleTier } from "../learning/learning-mode";
import { buildCalibrationSignals, type CalibrationRow, type CalibrationSignal } from "./calibration";
import type {
  MentorRequest,
  MentorRequestStatus,
  ProficiencyLevel,
  SkillCategory,
  SkillEntry,
  SkillsGraphSummary,
} from "./types";

export { PROFICIENCY_LEVELS, SKILL_CATEGORIES };

export type SkillsGraphSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SkillsGraphView =
  | {
      status: "setup_required";
      message: string;
      steps: SkillsGraphSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      members: Array<{ userId: string; userName: string }>;
      entries: SkillEntry[];
      requests: MentorRequest[];
      /**
       * "Call Your Shot" prediction-calibration evidence (learning_predictions,
       * fetched under RLS so students only ever see their own). Signals may
       * PROPOSE a skills entry; a human accepts or ignores — never automatic.
       */
      calibration: CalibrationSignal[];
      /** True when the viewer is owner/admin — the tier that countersigns proposals. */
      viewerCanCountersign: boolean;
      summary: SkillsGraphSummary;
      computedAt: string;
    };

function isCategory(value: unknown): value is SkillCategory {
  return typeof value === "string" && (SKILL_CATEGORIES as string[]).includes(value);
}

function isProficiency(value: unknown): value is ProficiencyLevel {
  return typeof value === "string" && (PROFICIENCY_LEVELS as string[]).includes(value);
}

function isRequestStatus(value: unknown): value is MentorRequestStatus {
  return value === "open" || value === "matched" || value === "closed";
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null; role: string | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; role: string | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role
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

type EntryRow = {
  id: string;
  userId: string;
  userName: string;
  skillCategory: SkillCategory;
  customLabel: string | null;
  proficiency: ProficiencyLevel;
  evidenceNote: string | null;
  createdAt: string;
};

type EvidenceRow = { userName: string; skillCategory: string; completedCount: string };

type RequestRow = {
  id: string;
  requesterUserId: string;
  requesterName: string;
  skillCategory: SkillCategory;
  note: string | null;
  status: string;
  matchedUserId: string | null;
  matchedUserName: string | null;
  matchedRationale: string | null;
  createdAt: string;
};

type MemberRow = { userId: string; userName: string };

function evidenceKey(userName: string, category: string): string {
  return `${userName.trim().toLowerCase()}::${category}`;
}

export async function computeSkillsGraphView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<SkillsGraphView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to build the skills and mentorship graph.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [memberResult, entryResult, evidenceResult, requestResult, calibrationResult] = await Promise.all([
    client.query<MemberRow>(
      `SELECT u.id AS "userId", u.name AS "userName"
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1
       ORDER BY u.name`,
      [org.orgId],
    ),
    client.query<EntryRow>(
      `SELECT e.id, e.user_id AS "userId", u.name AS "userName", e.skill_category AS "skillCategory",
              e.custom_label AS "customLabel", e.proficiency, e.evidence_note AS "evidenceNote",
              e.created_at AS "createdAt"
       FROM skills_graph_entries e
       JOIN users u ON u.id = e.user_id
       WHERE e.org_id = $1
       ORDER BY e.created_at DESC`,
      [org.orgId],
    ),
    client.query<EvidenceRow>(
      `SELECT u.name AS "userName", t.subsystem AS "skillCategory", count(*)::text AS "completedCount"
       FROM build_tasks t
       JOIN memberships m ON m.org_id = t.org_id
       JOIN users u ON u.id = m.user_id
       WHERE t.org_id = $1 AND t.status = 'done' AND lower(t.assignee) = lower(u.name)
       GROUP BY u.name, t.subsystem`,
      [org.orgId],
    ),
    client.query<RequestRow>(
      `SELECT r.id, r.requester_user_id AS "requesterUserId", ru.name AS "requesterName",
              r.skill_category AS "skillCategory", r.note, r.status,
              r.matched_user_id AS "matchedUserId", mu.name AS "matchedUserName",
              r.matched_rationale AS "matchedRationale", r.created_at AS "createdAt"
       FROM skills_graph_mentor_requests r
       JOIN users ru ON ru.id = r.requester_user_id
       LEFT JOIN users mu ON mu.id = r.matched_user_id
       WHERE r.org_id = $1
       ORDER BY r.created_at DESC`,
      [org.orgId],
    ),
    // "Call Your Shot" calibration (0452_learning_predictions.sql). RLS already
    // limits this to the viewer's own rows unless they are owner/admin, so a
    // student's signals are visible to that student and to mentors — never to
    // another student.
    client.query<{
      userId: string;
      userName: string | null;
      surface: string;
      scored: string;
      spotOn: string;
      close: string;
      off: string;
      skipped: string;
      lastCallAt: string | null;
    }>(
      `SELECT p.user_id AS "userId", u.name AS "userName", p.surface,
              count(*) FILTER (WHERE NOT p.skipped AND p.closeness IS NOT NULL)::text AS "scored",
              count(*) FILTER (WHERE p.closeness = 'spot-on')::text AS "spotOn",
              count(*) FILTER (WHERE p.closeness = 'close')::text AS "close",
              count(*) FILTER (WHERE p.closeness = 'off')::text AS "off",
              count(*) FILTER (WHERE p.skipped)::text AS "skipped",
              max(p.created_at)::text AS "lastCallAt"
       FROM learning_predictions p
       JOIN users u ON u.id = p.user_id
       WHERE p.org_id = $1::uuid
       GROUP BY p.user_id, u.name, p.surface`,
      [org.orgId],
    ),
  ]);

  const evidenceByKey = new Map<string, number>();
  for (const row of evidenceResult.rows) {
    evidenceByKey.set(evidenceKey(row.userName, row.skillCategory), Number(row.completedCount) || 0);
  }

  const entries: SkillEntry[] = entryResult.rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    skillCategory: isCategory(row.skillCategory) ? row.skillCategory : "other",
    customLabel: row.customLabel,
    proficiency: isProficiency(row.proficiency) ? row.proficiency : "developing",
    evidenceNote: row.evidenceNote,
    taskEvidenceCount: evidenceByKey.get(evidenceKey(row.userName, row.skillCategory)) ?? 0,
    createdAt: row.createdAt,
  }));

  const requests: MentorRequest[] = requestResult.rows.map((row) => {
    const category = isCategory(row.skillCategory) ? row.skillCategory : "other";
    const candidateEntries = entries
      .filter((e) => e.skillCategory === category)
      .map((e) => ({
        userId: e.userId,
        userName: e.userName,
        proficiency: e.proficiency,
        taskEvidenceCount: e.taskEvidenceCount,
        evidenceNote: e.evidenceNote,
      }));
    const candidates = rankMentorCandidates(candidateEntries, row.requesterUserId).slice(0, 5);
    return {
      id: row.id,
      requesterUserId: row.requesterUserId,
      requesterName: row.requesterName,
      skillCategory: category,
      note: row.note,
      status: isRequestStatus(row.status) ? row.status : "open",
      matchedUserId: row.matchedUserId,
      matchedUserName: row.matchedUserName,
      matchedRationale: row.matchedRationale,
      candidates,
      createdAt: row.createdAt,
    };
  });

  const categories = new Set(entries.map((e) => e.skillCategory));
  const members = memberResult.rows.map((r) => ({ userId: r.userId, userName: r.userName }));

  const calibration = buildCalibrationSignals(
    calibrationResult.rows.map<CalibrationRow>((r) => ({
      userId: r.userId,
      userName: r.userName,
      surface: r.surface,
      scored: Number(r.scored) || 0,
      spotOn: Number(r.spotOn) || 0,
      close: Number(r.close) || 0,
      off: Number(r.off) || 0,
      skipped: Number(r.skipped) || 0,
      lastCallAt: r.lastCallAt,
    })),
  );

  const summary: SkillsGraphSummary = {
    totalEntries: entries.length,
    totalMembers: new Set(entries.map((e) => e.userId)).size,
    totalCategories: categories.size,
    openRequests: requests.filter((r) => r.status === "open").length,
    matchedRequests: requests.filter((r) => r.status === "matched").length,
  };

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    members,
    entries,
    requests,
    calibration,
    viewerCanCountersign: roleTier(org.role) === "mentor",
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addSkillEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    targetUserId: string;
    skillCategory: SkillCategory;
    customLabel: string | null;
    proficiency: ProficiencyLevel;
    evidenceNote: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO skills_graph_entries (
       org_id, user_id, skill_category, custom_label, proficiency, evidence_note, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.orgId,
      input.targetUserId,
      input.skillCategory,
      input.customLabel,
      input.proficiency,
      input.evidenceNote,
      input.userId,
    ],
  );
}

export async function deleteSkillEntry(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM skills_graph_entries WHERE id = $1 AND org_id = $2`, [
    input.entryId,
    input.orgId,
  ]);
}

/** Creates a mentor request and immediately runs the deterministic local match computation. */
export async function requestMentor(
  client: PoolClient,
  input: { orgId: string; userId: string; skillCategory: SkillCategory; note: string | null },
): Promise<void> {
  const entryResult = await client.query<EntryRow>(
    `SELECT e.id, e.user_id AS "userId", u.name AS "userName", e.skill_category AS "skillCategory",
            e.custom_label AS "customLabel", e.proficiency, e.evidence_note AS "evidenceNote",
            e.created_at AS "createdAt"
     FROM skills_graph_entries e
     JOIN users u ON u.id = e.user_id
     WHERE e.org_id = $1 AND e.skill_category = $2`,
    [input.orgId, input.skillCategory],
  );
  const evidenceResult = await client.query<EvidenceRow>(
    `SELECT u.name AS "userName", t.subsystem AS "skillCategory", count(*)::text AS "completedCount"
     FROM build_tasks t
     JOIN memberships m ON m.org_id = t.org_id
     JOIN users u ON u.id = m.user_id
     WHERE t.org_id = $1 AND t.status = 'done' AND lower(t.assignee) = lower(u.name) AND t.subsystem = $2
     GROUP BY u.name, t.subsystem`,
    [input.orgId, input.skillCategory],
  );
  const evidenceByName = new Map<string, number>();
  for (const row of evidenceResult.rows) {
    evidenceByName.set(row.userName.trim().toLowerCase(), Number(row.completedCount) || 0);
  }
  const candidateEntries = entryResult.rows.map((row) => ({
    userId: row.userId,
    userName: row.userName,
    proficiency: isProficiency(row.proficiency) ? row.proficiency : "developing",
    taskEvidenceCount: evidenceByName.get(row.userName.trim().toLowerCase()) ?? 0,
    evidenceNote: row.evidenceNote,
  }));

  const requestId = `skills-graph-${randomUUID()}`;
  const match = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "skills_graph",
    requestId,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      skillCategory: input.skillCategory,
      candidateCount: candidateEntries.length,
      note: "Deterministic proficiency + completed-task-evidence mentor ranking — no external model call",
    },
    invoke: async () => ({
      value: rankMentorCandidates(candidateEntries, input.userId),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-skills-graph-v1",
      provider: "vantage-local",
    }),
  });

  const top = match[0] ?? null;

  await client.query(
    `INSERT INTO skills_graph_mentor_requests (
       org_id, requester_user_id, skill_category, note, status, matched_user_id, matched_rationale, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.orgId,
      input.userId,
      input.skillCategory,
      input.note,
      top ? "matched" : "open",
      top ? top.userId : null,
      top ? top.rationale : null,
      input.userId,
    ],
  );
}

export async function closeMentorRequest(
  client: PoolClient,
  input: { orgId: string; requestId: string },
): Promise<void> {
  await client.query(
    `UPDATE skills_graph_mentor_requests SET status = 'closed', updated_at = now() WHERE id = $1 AND org_id = $2`,
    [input.requestId, input.orgId],
  );
}
