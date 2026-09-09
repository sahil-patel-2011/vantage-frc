/**
 * Team Forms data access.
 *
 * Every query runs on the PoolClient handed out by `withRls`, so RLS is what
 * enforces tenancy; the explicit `org_id = $n` predicates are a second layer,
 * not the first. Nothing here imports @vantage/db/admin.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { MULTI_SEPARATOR, summarizeQuestion, type AnswerRow, type QuestionSummary } from "./results";
import {
  defaultConfigFor,
  numericValue,
  type FormAudience,
  type FormPurpose,
  type FormQuestion,
  type FormStatus,
  type FormSummary,
  type QuestionKind,
} from "./types";

export type FormDetail = {
  id: string;
  title: string;
  description: string;
  purpose: FormPurpose;
  status: FormStatus;
  audience: FormAudience;
  shareToken: string | null;
  closesAt: string | null;
  createdAt: string;
  questions: FormQuestion[];
};

type QuestionRow = {
  id: string;
  position: number;
  kind: QuestionKind;
  label: string;
  help: string;
  required: boolean;
  config: unknown;
};

function parseConfig(raw: unknown): FormQuestion["config"] {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as FormQuestion["config"];
  return {};
}

export async function listForms(client: PoolClient, orgId: string): Promise<FormSummary[]> {
  const result = await client.query<FormSummary>(
    `SELECT f.id,
            f.title,
            f.description,
            f.purpose,
            f.status,
            f.audience,
            f.share_token AS "shareToken",
            f.closes_at::text AS "closesAt",
            f.created_at::text AS "createdAt",
            (SELECT count(*)::int FROM form_questions q WHERE q.form_id = f.id) AS "questionCount",
            (SELECT count(*)::int FROM form_responses r WHERE r.form_id = f.id) AS "responseCount",
            (SELECT count(*)::int FROM form_assignments a WHERE a.form_id = f.id) AS "assignedCount"
       FROM forms f
      WHERE f.org_id = $1::uuid
      ORDER BY f.created_at DESC`,
    [orgId],
  );
  return result.rows;
}

export async function getForm(
  client: PoolClient,
  orgId: string,
  formId: string,
): Promise<FormDetail | null> {
  const form = await client.query<Omit<FormDetail, "questions">>(
    `SELECT id, title, description, purpose, status, audience,
            share_token AS "shareToken", closes_at::text AS "closesAt",
            created_at::text AS "createdAt"
       FROM forms WHERE id = $1::uuid AND org_id = $2::uuid`,
    [formId, orgId],
  );
  const row = form.rows[0];
  if (!row) return null;

  const questions = await client.query<QuestionRow>(
    `SELECT id, position, kind, label, help, required, config
       FROM form_questions WHERE form_id = $1::uuid AND org_id = $2::uuid
      ORDER BY position`,
    [formId, orgId],
  );

  return {
    ...row,
    questions: questions.rows.map((q) => ({ ...q, config: parseConfig(q.config) })),
  };
}

export async function createForm(
  client: PoolClient,
  input: { orgId: string; userId: string; title: string; purpose: FormPurpose; description?: string },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO forms (org_id, title, description, purpose, created_by, season_year)
     VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::int)
     RETURNING id`,
    [
      input.orgId,
      input.title.trim(),
      (input.description ?? "").trim(),
      input.purpose,
      input.userId,
      new Date().getUTCFullYear(),
    ],
  );
  const created = result.rows[0];
  if (!created) throw new Error("Could not create the form");
  return created.id;
}

export async function addQuestion(
  client: PoolClient,
  input: {
    orgId: string;
    formId: string;
    kind: QuestionKind;
    label: string;
    required?: boolean;
    help?: string;
    config?: FormQuestion["config"];
  },
): Promise<string> {
  // The position is computed inside the INSERT rather than by a separate SELECT.
  // Read-then-insert let two concurrent adds pick the same position and trip the
  // deferred UNIQUE (form_id, position) at COMMIT, failing one request with an
  // opaque 400 that a retry would have fixed.
  const result = await client.query<{ id: string }>(
    `INSERT INTO form_questions (org_id, form_id, position, kind, label, help, required, config)
     SELECT $1::uuid, $2::uuid,
            COALESCE((SELECT max(q.position) + 1 FROM form_questions q
                       WHERE q.form_id = $2::uuid AND q.org_id = $1::uuid), 0),
            $3, $4, $5, $6, $7::jsonb
     RETURNING id`,
    [
      input.orgId,
      input.formId,
      input.kind,
      input.label.trim() || "Untitled question",
      (input.help ?? "").trim(),
      input.required ?? false,
      JSON.stringify(input.config ?? defaultConfigFor(input.kind)),
    ],
  );
  const created = result.rows[0];
  if (!created) throw new Error("Could not add the question");
  return created.id;
}

export async function updateQuestion(
  client: PoolClient,
  input: {
    orgId: string;
    questionId: string;
    label?: string;
    help?: string;
    required?: boolean;
    config?: FormQuestion["config"];
  },
): Promise<void> {
  await client.query(
    `UPDATE form_questions
        SET label = COALESCE($3, label),
            help = COALESCE($4, help),
            required = COALESCE($5, required),
            config = COALESCE($6::jsonb, config)
      WHERE id = $1::uuid AND org_id = $2::uuid`,
    [
      input.questionId,
      input.orgId,
      input.label?.trim() ?? null,
      input.help?.trim() ?? null,
      input.required ?? null,
      input.config ? JSON.stringify(input.config) : null,
    ],
  );
}

export async function deleteQuestion(client: PoolClient, orgId: string, questionId: string): Promise<void> {
  await client.query(`DELETE FROM form_questions WHERE id = $1::uuid AND org_id = $2::uuid`, [questionId, orgId]);
}

/**
 * Move a question one slot up or down.
 *
 * The (form_id, position) unique constraint is DEFERRABLE INITIALLY DEFERRED so
 * the two rows can hold the same position momentarily inside the statement
 * pair; without that the first UPDATE would collide with the row it is about to
 * swap with.
 */
export async function moveQuestion(
  client: PoolClient,
  orgId: string,
  questionId: string,
  direction: "up" | "down",
): Promise<void> {
  const current = await client.query<{ formId: string; position: number }>(
    `SELECT form_id AS "formId", position FROM form_questions WHERE id = $1::uuid AND org_id = $2::uuid`,
    [questionId, orgId],
  );
  const row = current.rows[0];
  if (!row) return;
  const { formId, position } = row;
  const comparison = direction === "up" ? "<" : ">";
  const order = direction === "up" ? "DESC" : "ASC";
  const neighbour = await client.query<{ id: string; position: number }>(
    `SELECT id, position FROM form_questions
      WHERE form_id = $1::uuid AND org_id = $2::uuid AND position ${comparison} $3::int
      ORDER BY position ${order} LIMIT 1`,
    [formId, orgId, position],
  );
  const swap = neighbour.rows[0];
  if (!swap) return;
  await client.query(`UPDATE form_questions SET position = $2::int WHERE id = $1::uuid`, [questionId, swap.position]);
  await client.query(`UPDATE form_questions SET position = $2::int WHERE id = $1::uuid`, [swap.id, position]);
}

export async function setFormStatus(
  client: PoolClient,
  orgId: string,
  formId: string,
  status: FormStatus,
  audience: FormAudience,
): Promise<void> {
  // A link-audience form needs a token to be reachable; generate it on the way
  // to `open` and keep it stable afterwards so a shared URL never breaks.
  await client.query(
    `UPDATE forms
        SET status = $3,
            audience = $4,
            share_token = CASE
              WHEN $4 = 'link' AND share_token IS NULL THEN encode(gen_random_bytes(16), 'hex')
              ELSE share_token
            END,
            updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid`,
    [formId, orgId, status, audience],
  );
}

/**
 * Mint a fresh share token, invalidating every URL already handed out.
 *
 * Without this a leaked intake link — one carrying guardian names and phone
 * numbers — could not be revoked: switching audience to `members` disabled it,
 * but switching back restored the SAME token and the leaked URL worked again.
 */
export async function rotateShareToken(
  client: PoolClient,
  orgId: string,
  formId: string,
): Promise<string | null> {
  const result = await client.query<{ shareToken: string | null }>(
    `UPDATE forms
        SET share_token = encode(gen_random_bytes(16), 'hex'), updated_at = now()
      WHERE id = $2::uuid AND org_id = $1::uuid
      RETURNING share_token AS "shareToken"`,
    [orgId, formId],
  );
  return result.rows[0]?.shareToken ?? null;
}

export async function assignForm(
  client: PoolClient,
  input: { orgId: string; formId: string; userIds: string[]; assignedBy: string },
): Promise<number> {
  if (input.userIds.length === 0) return 0;
  // Join memberships rather than inserting the ids as given. The RLS policy
  // only checks the CALLER's role, not that the assignee belongs to the org, so
  // without this an admin could create an assignment for any uuid in the system
  // — inflating assignedCount (which the results insight reports as "N of M
  // assigned") and telling an outsider the form exists.
  const result = await client.query(
    `INSERT INTO form_assignments (org_id, form_id, user_id, assigned_by)
     SELECT $1::uuid, $2::uuid, m.user_id, $3::uuid
       FROM unnest($4::uuid[]) AS requested(user_id)
       JOIN memberships m ON m.user_id = requested.user_id AND m.org_id = $1::uuid
     ON CONFLICT (form_id, user_id) DO NOTHING`,
    [input.orgId, input.formId, input.assignedBy, input.userIds],
  );
  return result.rowCount ?? 0;
}

export type SubmitAnswer = { questionId: string; value: string | string[] };

export async function submitResponse(
  client: PoolClient,
  input: {
    orgId: string;
    formId: string;
    userId: string | null;
    respondentLabel?: string;
    answers: SubmitAnswer[];
    questions: FormQuestion[];
  },
): Promise<string> {
  const response = await client.query<{ id: string }>(
    `INSERT INTO form_responses (org_id, form_id, respondent_user_id, respondent_label)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
     RETURNING id`,
    [input.orgId, input.formId, input.userId, (input.respondentLabel ?? "").trim()],
  );
  const created = response.rows[0];
  if (!created) throw new Error("Could not record the response");
  const responseId = created.id;

  const byId = new Map(input.questions.map((q) => [q.id, q]));
  for (const answer of input.answers) {
    const question = byId.get(answer.questionId);
    if (!question) continue;
    const text = Array.isArray(answer.value) ? answer.value.join(MULTI_SEPARATOR) : String(answer.value ?? "");
    if (!text.trim()) continue;
    await client.query(
      `INSERT INTO form_answers (org_id, response_id, question_id, value_text, value_number)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
       ON CONFLICT (response_id, question_id) DO UPDATE
         SET value_text = excluded.value_text, value_number = excluded.value_number`,
      [input.orgId, responseId, question.id, text, numericValue(question.kind, text)],
    );
  }
  return responseId;
}

export type FormResults = {
  totalResponses: number;
  assignedCount: number;
  /** Of the assigned people, how many have answered. Never derived from the response count. */
  respondedAssignees: number;
  summaries: QuestionSummary[];
  responses: Array<{ id: string; label: string; submittedAt: string; hasAccount: boolean }>;
  /**
   * Answers that arrived through the share link from someone with no account.
   *
   * Carried separately because it decides what the team can and cannot do next:
   * these people typed an address into a question so a team could reach them,
   * which is not consent for Vantage to email them, and there is no preferences
   * row or unsubscribe token to honour if it did. The route from here is an
   * invite, not a mailing list.
   */
  linkResponses: number;
};

export async function getResults(
  client: PoolClient,
  orgId: string,
  form: FormDetail,
): Promise<FormResults> {
  const responses = await client.query<{
    id: string;
    label: string;
    submittedAt: string;
    hasAccount: boolean;
  }>(
    `SELECT r.id,
            COALESCE(NULLIF(r.respondent_label, ''), COALESCE(u.name, 'Anonymous')) AS label,
            r.submitted_at::text AS "submittedAt",
            (r.respondent_user_id IS NOT NULL) AS "hasAccount"
       FROM form_responses r
       LEFT JOIN users u ON u.id = r.respondent_user_id
      WHERE r.form_id = $1::uuid AND r.org_id = $2::uuid
      ORDER BY r.submitted_at DESC`,
    [form.id, orgId],
  );

  const answers = await client.query<AnswerRow>(
    `SELECT a.question_id AS "questionId",
            a.response_id AS "responseId",
            a.value_text AS "valueText",
            a.value_number::float8 AS "valueNumber"
       FROM form_answers a
       JOIN form_responses r ON r.id = a.response_id
      WHERE r.form_id = $1::uuid AND a.org_id = $2::uuid`,
    [form.id, orgId],
  );

  // Two different numbers: how many people were asked, and how many of THOSE
  // answered. Deriving the second from the response count treats a stranger's
  // link answer as an assignee's, which makes coverage rise when the wrong
  // people reply.
  const assigned = await client.query<{ count: number; responded: number }>(
    `SELECT count(*)::int AS count,
            count(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM form_responses r
                 WHERE r.form_id = a.form_id
                   AND r.respondent_user_id = a.user_id
              )
            )::int AS responded
       FROM form_assignments a
      WHERE a.form_id = $1::uuid AND a.org_id = $2::uuid`,
    [form.id, orgId],
  );

  const total = responses.rowCount ?? 0;
  return {
    totalResponses: total,
    assignedCount: assigned.rows[0]?.count ?? 0,
    respondedAssignees: assigned.rows[0]?.responded ?? 0,
    summaries: form.questions.map((question) => summarizeQuestion(question, answers.rows, total)),
    responses: responses.rows,
    linkResponses: responses.rows.filter((row) => !row.hasAccount).length,
  };
}
