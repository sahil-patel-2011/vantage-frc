import type { PoolClient } from "@neondatabase/serverless";
import { certificationStatus, computeExpiryDate, summarizeTraining } from ".";
import type { TrainingCategory, TrainingCertification, TrainingSkill, TrainingSummary } from "./types";

export const TRAINING_CATEGORIES: TrainingCategory[] = [
  "mill",
  "lathe",
  "wiring",
  "drive",
  "safety",
  "software",
  "other",
];

export type TrainingSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type TrainingMemberOption = {
  userId: string;
  name: string;
  email: string;
};

export type TrainingView =
  | {
      status: "setup_required";
      message: string;
      steps: TrainingSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      skills: TrainingSkill[];
      certifications: TrainingCertification[];
      members: TrainingMemberOption[];
      summary: TrainingSummary;
      /** Writes are owner/admin; the matrix itself stays readable by the whole team. */
      canManage: boolean;
      computedAt: string;
    };

type SkillRow = {
  id: string;
  name: string;
  category: TrainingCategory;
  description: string | null;
  validityMonths: number | null;
  createdAt: string;
};

type CertificationRow = {
  id: string;
  skillId: string;
  skillName: string;
  skillCategory: TrainingCategory;
  memberUserId: string;
  memberName: string;
  memberEmail: string;
  certifiedByUserId: string;
  certifiedByName: string;
  certifiedAt: string;
  expiresAt: string | null;
  notes: string | null;
};

function mapSkill(row: SkillRow): TrainingSkill {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    validityMonths: row.validityMonths == null ? null : Number(row.validityMonths),
    createdAt: row.createdAt,
  };
}

function mapCertification(row: CertificationRow, now: Date): TrainingCertification {
  return {
    id: row.id,
    skillId: row.skillId,
    skillName: row.skillName,
    skillCategory: row.skillCategory,
    memberUserId: row.memberUserId,
    memberName: row.memberName,
    memberEmail: row.memberEmail,
    certifiedByUserId: row.certifiedByUserId,
    certifiedByName: row.certifiedByName,
    certifiedAt: row.certifiedAt,
    expiresAt: row.expiresAt,
    notes: row.notes,
    status: certificationStatus(row.expiresAt, now),
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null; role: string } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; role: string }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role::text AS role
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

export async function computeTrainingView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; now?: Date },
): Promise<TrainingView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const now = input.now ?? new Date();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to build the training matrix.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [skillResult, certResult, memberResult] = await Promise.all([
    client.query<SkillRow>(
      `SELECT id, name, category, description, validity_months AS "validityMonths",
              created_at::text AS "createdAt"
       FROM training_skills
       WHERE org_id = $1
       ORDER BY category, name`,
      [org.orgId],
    ),
    client.query<CertificationRow>(
      `SELECT c.id, c.skill_id AS "skillId", s.name AS "skillName", s.category AS "skillCategory",
              c.member_user_id AS "memberUserId", mu.name AS "memberName", mu.email AS "memberEmail",
              c.certified_by AS "certifiedByUserId", cu.name AS "certifiedByName",
              c.certified_at::text AS "certifiedAt", c.expires_at::text AS "expiresAt", c.notes
       FROM training_certifications c
       JOIN training_skills s ON s.id = c.skill_id
       JOIN users mu ON mu.id = c.member_user_id
       JOIN users cu ON cu.id = c.certified_by
       WHERE c.org_id = $1
       ORDER BY c.certified_at DESC`,
      [org.orgId],
    ),
    client.query<TrainingMemberOption>(
      `SELECT u.id AS "userId", u.name, u.email
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1
       ORDER BY u.name`,
      [org.orgId],
    ),
  ]);

  const skills = skillResult.rows.map(mapSkill);
  const certifications = certResult.rows.map((row) => mapCertification(row, now));
  const summary = summarizeTraining(certifications, skills.length);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    skills,
    certifications,
    members: memberResult.rows,
    summary,
    canManage: org.role === "owner" || org.role === "admin",
    computedAt: now.toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addSkill(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    category: TrainingCategory;
    description: string | null;
    validityMonths: number | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO training_skills (org_id, name, category, description, validity_months, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.orgId, input.name, input.category, input.description, input.validityMonths, input.userId],
  );
}

export async function deleteSkill(client: PoolClient, input: { orgId: string; skillId: string }): Promise<void> {
  await client.query(`DELETE FROM training_skills WHERE id = $1 AND org_id = $2`, [input.skillId, input.orgId]);
}

export async function certifyMember(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    skillId: string;
    memberUserId: string;
    certifiedAt: string;
    expiresAt: string | null;
    notes: string | null;
  },
): Promise<void> {
  let expiresAt = input.expiresAt;
  if (!expiresAt) {
    const skillResult = await client.query<{ validityMonths: number | null }>(
      `SELECT validity_months AS "validityMonths" FROM training_skills WHERE id = $1 AND org_id = $2`,
      [input.skillId, input.orgId],
    );
    const validityMonths = skillResult.rows[0]?.validityMonths ?? null;
    expiresAt = computeExpiryDate(input.certifiedAt, validityMonths);
  }
  await client.query(
    `INSERT INTO training_certifications (
       org_id, skill_id, member_user_id, certified_by, certified_at, expires_at, notes
     ) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7)`,
    [input.orgId, input.skillId, input.memberUserId, input.userId, input.certifiedAt, expiresAt, input.notes],
  );
}

export async function revokeCertification(
  client: PoolClient,
  input: { orgId: string; certificationId: string },
): Promise<void> {
  await client.query(`DELETE FROM training_certifications WHERE id = $1 AND org_id = $2`, [
    input.certificationId,
    input.orgId,
  ]);
}
