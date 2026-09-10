import type { PoolClient } from "@neondatabase/serverless";
import { auth, resolveAuthBaseURL } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addQuestion,
  assignForm,
  createForm,
  deleteQuestion,
  getForm,
  getResults,
  listForms,
  moveQuestion,
  rotateShareToken,
  setFormStatus,
  submitResponse,
  updateQuestion,
} from "../../../lib/forms/store";
import { formInsight } from "../../../lib/forms/results";
import { planDuesReminders, sendDuesReminders } from "../../../lib/forms/dues-reminders";
import {
  isFormPurpose,
  isQuestionKind,
  STARTER_QUESTIONS,
  type FormAudience,
  type FormStatus,
  type QuestionConfig,
} from "../../../lib/forms/types";

// Sending dues reminders to a whole squad is a bounded set of provider round
// trips, which is more than the default budget allows for.
export const maxDuration = 60;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

type Membership = { orgId: string; orgName: string; role: string };

/**
 * Resolve the team without demanding a query parameter.
 *
 * The scouting form builder gates on `searchParams.orgId` and shows "setup
 * required" forever when you open it from the nav, even with exactly one team.
 * Falling back to the caller's single membership avoids repeating that.
 */
async function resolveMembership(
  client: PoolClient,
  userId: string,
  requestedOrgId: string | null,
): Promise<Membership> {
  const result = await client.query<Membership>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid
        AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY o.name
      LIMIT 2`,
    [userId, requestedOrgId],
  );
  const membership = result.rows[0];
  if (!membership) throw new HttpError(403, "Organization membership required");
  return membership;
}

function requireAdmin(membership: Membership) {
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new HttpError(403, "Only owners and admins can change forms");
  }
}

/**
 * Narrow a caller-supplied config object to the fields a question actually has.
 *
 * This used to be `body.config as never`, which wrote arbitrary JSON into the
 * jsonb column. A string or array then survived the write but was rejected by
 * parseConfig on read, so a select question silently lost its options.
 */
function parseQuestionConfig(raw: unknown): QuestionConfig | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "Question settings must be an object");
  }
  const input = raw as Record<string, unknown>;
  const config: QuestionConfig = {};
  if (input.options !== undefined) {
    if (!Array.isArray(input.options)) throw new HttpError(400, "Options must be a list");
    const options = input.options
      .map((option) => String(option).trim())
      .filter((option) => option.length > 0 && option.length <= 200)
      .slice(0, 50);
    // Duplicate options make a bar chart that double-counts one answer.
    config.options = [...new Set(options)];
  }
  for (const key of ["min", "max", "step"] as const) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new HttpError(400, `${key} must be a number`);
    config[key] = parsed;
  }
  return config;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Form request failed" }, { status });
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const formId = url.searchParams.get("formId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);

      if (!formId) {
        return {
          status: "ready" as const,
          orgId: membership.orgId,
          orgName: membership.orgName,
          canManage: membership.role === "owner" || membership.role === "admin",
          forms: await listForms(client, membership.orgId),
        };
      }

      const form = await getForm(client, membership.orgId, formId);
      if (!form) throw new HttpError(404, "Form not found");
      const canManage = membership.role === "owner" || membership.role === "admin";

      // Results are a leadership view. RLS limits form_responses to the
      // caller's own row for a non-manager, so computing them anyway produced a
      // payload that read as team-wide ("1 response from prospective members")
      // while describing one person. Better to return nothing than a figure
      // that is honest only by accident.
      if (!canManage) {
        return {
          status: "ready" as const,
          orgId: membership.orgId,
          orgName: membership.orgName,
          canManage,
          form,
          results: null,
          insight: null,
        };
      }

      const results = await getResults(client, membership.orgId, form);
      // Only leadership sees who is behind on dues, and only on a dues form.
      // The non-manager case already returned above, so reaching here is the
      // leadership check — no second copy of it.
      const duesPlan =
        form.purpose === "dues"
          ? await planDuesReminders(client, { orgId: membership.orgId, form })
          : null;
      return {
        status: "ready" as const,
        orgId: membership.orgId,
        orgName: membership.orgName,
        canManage,
        form,
        results,
        duesPlan,
        insight: formInsight({
          purpose: form.purpose,
          totalResponses: results.totalResponses,
          assignedCount: results.assignedCount,
          respondedAssignees: results.respondedAssignees,
          summaries: results.summaries,
        }),
      };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

type Action =
  | { action: "create_form"; title: string; purpose: string; description?: string; useStarter?: boolean }
  | { action: "add_question"; formId: string; kind: string; label: string; required?: boolean }
  | { action: "update_question"; questionId: string; label?: string; help?: string; required?: boolean; config?: Record<string, unknown> }
  | { action: "delete_question"; questionId: string }
  | { action: "move_question"; questionId: string; direction: "up" | "down" }
  | { action: "set_status"; formId: string; status: FormStatus; audience: FormAudience }
  | { action: "rotate_link"; formId: string }
  | { action: "assign"; formId: string; userIds: string[] }
  | { action: "submit"; formId: string; answers: Array<{ questionId: string; value: string | string[] }> }
  | { action: "send_dues_reminders"; formId: string; includeNoResponse?: boolean };

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as Action;
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");

    const result = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      const orgId = membership.orgId;

      switch (body.action) {
        case "create_form": {
          requireAdmin(membership);
          const title = (body.title ?? "").trim();
          if (!title) throw new HttpError(400, "Give the form a title");
          if (title.length > 160) throw new HttpError(400, "Title must be 160 characters or fewer");
          if (!isFormPurpose(body.purpose)) throw new HttpError(400, "Pick a valid form purpose");
          const formId = await createForm(client, {
            orgId,
            userId: session.user.id,
            title,
            purpose: body.purpose,
            description: body.description,
          });
          // Starter questions are prompts for a blank form, never data. They are
          // opt-in so a team that wants a blank sheet gets one.
          if (body.useStarter) {
            for (const starter of STARTER_QUESTIONS[body.purpose] ?? []) {
              await addQuestion(client, {
                orgId,
                formId,
                kind: starter.kind,
                label: starter.label,
                required: starter.required,
                config: starter.config,
              });
            }
          }
          return { ok: true, formId };
        }

        case "add_question": {
          requireAdmin(membership);
          if (!isQuestionKind(body.kind)) throw new HttpError(400, "Pick a valid question type");
          const form = await getForm(client, orgId, body.formId);
          if (!form) throw new HttpError(404, "Form not found");
          const questionId = await addQuestion(client, {
            orgId,
            formId: body.formId,
            kind: body.kind,
            label: body.label,
            required: body.required,
          });
          return { ok: true, questionId };
        }

        case "update_question": {
          requireAdmin(membership);
          await updateQuestion(client, {
            orgId,
            questionId: body.questionId,
            label: body.label,
            help: body.help,
            required: body.required,
            config: parseQuestionConfig(body.config),
          });
          return { ok: true };
        }

        case "delete_question": {
          requireAdmin(membership);
          await deleteQuestion(client, orgId, body.questionId);
          return { ok: true };
        }

        case "move_question": {
          requireAdmin(membership);
          await moveQuestion(client, orgId, body.questionId, body.direction === "up" ? "up" : "down");
          return { ok: true };
        }

        case "set_status": {
          requireAdmin(membership);
          const status: FormStatus =
            body.status === "open" || body.status === "closed" ? body.status : "draft";
          const audience: FormAudience = body.audience === "link" ? "link" : "members";
          const form = await getForm(client, orgId, body.formId);
          if (!form) throw new HttpError(404, "Form not found");
          if (status === "open" && form.questions.length === 0) {
            throw new HttpError(400, "Add at least one question before opening the form");
          }
          await setFormStatus(client, orgId, body.formId, status, audience);
          return { ok: true };
        }

        case "rotate_link": {
          requireAdmin(membership);
          const shareToken = await rotateShareToken(client, orgId, body.formId);
          if (!shareToken) throw new HttpError(404, "Form not found");
          return { ok: true, shareToken };
        }

        case "assign": {
          requireAdmin(membership);
          const userIds = Array.isArray(body.userIds) ? body.userIds.filter(Boolean) : [];
          const assigned = await assignForm(client, {
            orgId,
            formId: body.formId,
            userIds,
            assignedBy: session.user.id,
          });
          return { ok: true, assigned };
        }

        case "submit": {
          const form = await getForm(client, orgId, body.formId);
          if (!form) throw new HttpError(404, "Form not found");
          if (form.status !== "open") throw new HttpError(400, "This form is not open for responses");
          const missing = form.questions.filter((question) => {
            if (!question.required) return false;
            const answer = body.answers?.find((a) => a.questionId === question.id);
            const value = Array.isArray(answer?.value) ? answer?.value.join("") : answer?.value;
            return !value || !String(value).trim();
          });
          if (missing.length > 0) {
            throw new HttpError(400, `Answer required: ${missing.map((q) => q.label).join(", ")}`);
          }
          const responseId = await submitResponse(client, {
            orgId,
            formId: body.formId,
            userId: session.user.id,
            answers: body.answers ?? [],
            questions: form.questions,
          });
          return { ok: true, responseId };
        }

        /**
         * Dues reminders are sent by a person, on purpose.
         *
         * There is no cron behind this. Chasing a teenager about money is a
         * decision a treasurer should make while looking at who is on the list
         * and who has been left off it — which is what `planDuesReminders`
         * returns to the page before this action is ever available.
         */
        case "send_dues_reminders": {
          requireAdmin(membership);
          const form = await getForm(client, orgId, body.formId);
          if (!form) throw new HttpError(404, "Form not found");
          const plan = await planDuesReminders(client, { orgId, form });
          if (!plan.ready) throw new HttpError(400, plan.blockedReason ?? "This form cannot send dues reminders.");
          const result = await sendDuesReminders(client, {
            orgId,
            orgName: membership.orgName,
            formId: form.id,
            formTitle: form.title,
            plan,
            sentBy: session.user.id,
            href: `${resolveAuthBaseURL().replace(/\/$/, "")}/forms/${form.id}`,
            includeNoResponse: body.includeNoResponse !== false,
          });
          return { ok: true, dues: result };
        }

        default:
          throw new HttpError(400, "Unknown form action");
      }
    });

    return Response.json(result);
  } catch (error) {
    // A second submission from the same member trips the partial unique index
    // rather than a check in application code, so translate it into the
    // sentence a respondent should actually see.
    if (error instanceof Error && /form_responses_one_per_member_uq/.test(error.message)) {
      return Response.json({ error: "You have already answered this form" }, { status: 409 });
    }
    return fail(error);
  }
}
