import type { PoolClient } from "@neondatabase/serverless";
import {
  SAFETY_CATEGORIES,
  completionStatus,
  expiryDateFor,
  summarizeSafetyTraining,
} from ".";
import type {
  SafetyCategory,
  SafetyCompletion,
  SafetyMemberCoverage,
  SafetyModule,
  SafetyTrainingSummary,
} from "./types";

export { SAFETY_CATEGORIES };

export type SafetyTrainingSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SafetyTrainingView =
  | {
      status: "setup_required";
      message: string;
      steps: SafetyTrainingSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      modules: SafetyModule[];
      completions: SafetyCompletion[];
      members: Array<{ id: string; name: string }>;
      coverage: SafetyMemberCoverage[];
      summary: SafetyTrainingSummary;
      computedAt: string;
    };

type ModuleRow = {
  id: string;
  title: string;
  category: SafetyCategory;
  description: string | null;
  isRequired: boolean;
  validityMonths: number | null;
  createdAt: string;
};

type CompletionRow = {
  id: string;
  moduleId: string;
  moduleTitle: string;
  category: SafetyCategory;
  isRequired: boolean;
  memberId: string;
  memberName: string;
  completedOn: string;
  expiresOn: string | null;
  certificateUrl: string | null;
  notes: string | null;
};

type MemberRow = { id: string; name: string };

function mapModule(row: ModuleRow): SafetyModule {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    isRequired: row.isRequired,
    validityMonths: row.validityMonths == null ? null : Number(row.validityMonths),
    createdAt: row.createdAt,
  };
}

function mapCompletion(row: CompletionRow, now: Date): SafetyCompletion {
  return {
    id: row.id,
    moduleId: row.moduleId,
    moduleTitle: row.moduleTitle,
    category: row.category,
    isRequired: row.isRequired,
    memberId: row.memberId,
    memberName: row.memberName,
    completedOn: row.completedOn,
    expiresOn: row.expiresOn,
    certificateUrl: row.certificateUrl,
    notes: row.notes,
    status: completionStatus(row.expiresOn, now),
  };
}

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

export async function computeSafetyTrainingView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<SafetyTrainingView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to track shop safety training and certifications.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [moduleResult, completionResult, memberResult] = await Promise.all([
    client.query<ModuleRow>(
      `SELECT id, title, category, description, is_required AS "isRequired",
              validity_months AS "validityMonths", created_at::text AS "createdAt"
       FROM safety_training_modules
       WHERE org_id = $1
       ORDER BY is_required DESC, title`,
      [org.orgId],
    ),
    client.query<CompletionRow>(
      `SELECT c.id, c.module_id AS "moduleId", m.title AS "moduleTitle", m.category,
              m.is_required AS "isRequired", c.member_id AS "memberId", u.name AS "memberName",
              c.completed_on::text AS "completedOn", c.expires_on::text AS "expiresOn",
              c.certificate_url AS "certificateUrl", c.notes
       FROM safety_training_completions c
       JOIN safety_training_modules m ON m.id = c.module_id
       JOIN users u ON u.id = c.member_id
       WHERE c.org_id = $1
       ORDER BY c.completed_on DESC`,
      [org.orgId],
    ),
    client.query<MemberRow>(
      `SELECT u.id, u.name
       FROM memberships mem
       JOIN users u ON u.id = mem.user_id
       WHERE mem.org_id = $1
       ORDER BY u.name`,
      [org.orgId],
    ),
  ]);

  const now = new Date();
  const modules = moduleResult.rows.map(mapModule);
  const completions = completionResult.rows.map((row) => mapCompletion(row, now));
  const members = memberResult.rows.map((row) => ({ id: row.id, name: row.name }));
  const { summary, coverage } = summarizeSafetyTraining(modules, completions, members);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    modules,
    completions,
    members,
    coverage,
    summary,
    computedAt: now.toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createModule(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    category: SafetyCategory;
    description: string | null;
    isRequired: boolean;
    validityMonths: number | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO safety_training_modules (
       org_id, title, category, description, is_required, validity_months, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.orgId,
      input.title,
      input.category,
      input.description,
      input.isRequired,
      input.validityMonths,
      input.userId,
    ],
  );
}

export async function deleteModule(
  client: PoolClient,
  input: { orgId: string; moduleId: string },
): Promise<void> {
  await client.query(`DELETE FROM safety_training_modules WHERE id = $1 AND org_id = $2`, [
    input.moduleId,
    input.orgId,
  ]);
}

export async function recordCompletion(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    moduleId: string;
    memberId: string;
    completedOn: string;
    certificateUrl: string | null;
    notes: string | null;
  },
): Promise<void> {
  const moduleResult = await client.query<{ validityMonths: number | null }>(
    `SELECT validity_months AS "validityMonths" FROM safety_training_modules WHERE id = $1 AND org_id = $2`,
    [input.moduleId, input.orgId],
  );
  const moduleRow = moduleResult.rows[0];
  if (!moduleRow) throw new Error("Safety training module not found");
  const validityMonths = moduleRow.validityMonths == null ? null : Number(moduleRow.validityMonths);
  const expiresOn = expiryDateFor(input.completedOn, validityMonths);
  await client.query(
    `INSERT INTO safety_training_completions (
       org_id, module_id, member_id, completed_on, expires_on, certificate_url, notes, recorded_by
     ) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8)`,
    [
      input.orgId,
      input.moduleId,
      input.memberId,
      input.completedOn,
      expiresOn,
      input.certificateUrl,
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteCompletion(
  client: PoolClient,
  input: { orgId: string; completionId: string },
): Promise<void> {
  await client.query(`DELETE FROM safety_training_completions WHERE id = $1 AND org_id = $2`, [
    input.completionId,
    input.orgId,
  ]);
}
