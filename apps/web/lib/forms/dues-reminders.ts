/**
 * Dues reminders: who gets chased, who never does, and who cannot be reached.
 *
 * Deliberately NOT a cron. Money and minors is the one place in this product
 * where a human should be on the hook for the send: a treasurer opens the dues
 * form, reads exactly who is about to be emailed and who is excluded and why,
 * and presses the button. Nothing in here fires on a schedule.
 *
 * The exclusion that matters is enforced twice — the send list is built only
 * from responses classified `owing` (see dues.ts, where assistance is
 * absorbing), and the form is refused outright if it offers no way to ask for
 * assistance in the first place.
 *
 * Everything runs on the `withRls` PoolClient. Nothing here imports
 * @vantage/db/admin.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { sendDuesReminderEmail } from "@vantage/core";
import { withSavepoint } from "@vantage/db/savepoint";
import { classifyDuesAnswer, findDuesStatusQuestion, type DuesStatus } from "./dues";
import type { FormDetail } from "./store";

export type DuesRecipient = {
  userId: string;
  name: string;
  reason: "owing" | "no_response";
};

export type DuesReminderPlan = {
  ready: boolean;
  /** Why no reminder can be sent from this form. Present only when !ready. */
  blockedReason?: string;
  questionLabel?: string;
  /** Members with an account whose own answer says they still owe. */
  owing: DuesRecipient[];
  /** Members who were assigned the form and have not answered at all. */
  noResponse: DuesRecipient[];
  /** Never emailed. Count only — the names live on the results page. */
  assistance: number;
  paid: number;
  /** Answers this feature could not read. Never emailed. */
  unreadable: number;
  /**
   * People who answered through the public link and have no account. They gave
   * their address to the team, not to Vantage, so we hold no consent, no
   * preferences row and no unsubscribe path for them.
   */
  offPlatform: number;
  /** Already reminded today, so the button cannot chase them twice. */
  remindedToday: number;
};

export type DuesSendResult = {
  sent: number;
  skippedPref: number;
  alreadyReminded: number;
  failed: number;
  assistanceFlagged: number;
};

type ResponseRow = {
  userId: string | null;
  name: string | null;
  value: string | null;
};

/**
 * Build the plan without sending anything.
 *
 * The treasurer sees this before the button does anything, because "9 will be
 * emailed, 2 asked for assistance and will not be, 3 answered through the link
 * and cannot be" is the information that makes the send a decision rather than
 * a reflex.
 */
export async function planDuesReminders(
  client: PoolClient,
  input: { orgId: string; form: FormDetail },
): Promise<DuesReminderPlan> {
  const empty: DuesReminderPlan = {
    ready: false,
    owing: [],
    noResponse: [],
    assistance: 0,
    paid: 0,
    unreadable: 0,
    offPlatform: 0,
    remindedToday: 0,
  };

  if (input.form.purpose !== "dues") {
    return { ...empty, blockedReason: "Dues reminders are only sent from a form whose purpose is Dues & payments." };
  }

  const check = findDuesStatusQuestion(input.form.questions);
  if (!check.ok) return { ...empty, blockedReason: check.reason };

  const responses = await client.query<ResponseRow>(
    `SELECT r.respondent_user_id AS "userId",
            COALESCE(NULLIF(u.name, ''), NULLIF(r.respondent_label, ''), u.email) AS name,
            a.value_text AS value
       FROM form_responses r
       LEFT JOIN users u ON u.id = r.respondent_user_id
       LEFT JOIN form_answers a
              ON a.response_id = r.id
             AND a.question_id = $3::uuid
      WHERE r.form_id = $1::uuid
        AND r.org_id = $2::uuid`,
    [input.form.id, input.orgId, check.question.id],
  );

  const remindedTodayRows = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId"
       FROM dues_reminder_log
      WHERE form_id = $1::uuid
        AND org_id = $2::uuid
        AND sent_on = CURRENT_DATE`,
    [input.form.id, input.orgId],
  );
  const remindedToday = new Set(remindedTodayRows.rows.map((row) => row.userId));

  const plan: DuesReminderPlan = { ...empty, ready: true, questionLabel: check.question.label };
  const answeredUserIds = new Set<string>();

  for (const row of responses.rows) {
    const status: DuesStatus = classifyDuesAnswer(row.value ?? "");
    if (row.userId) answeredUserIds.add(row.userId);

    if (status === "assistance") {
      plan.assistance += 1;
      continue;
    }
    if (status === "paid") {
      plan.paid += 1;
      continue;
    }
    if (status === "unknown") {
      plan.unreadable += 1;
      continue;
    }
    // status === "owing"
    if (!row.userId) {
      // Answered through the public link. There is no account, so no consent
      // record and no unsubscribe path: this is a name for a person to talk to,
      // not an address to mail.
      plan.offPlatform += 1;
      continue;
    }
    if (remindedToday.has(row.userId)) {
      plan.remindedToday += 1;
      continue;
    }
    plan.owing.push({ userId: row.userId, name: row.name ?? "Member", reason: "owing" });
  }

  const assigned = await client.query<{ userId: string; name: string }>(
    `SELECT fa.user_id AS "userId",
            COALESCE(NULLIF(u.name, ''), u.email, 'Member') AS name
       FROM form_assignments fa
       JOIN users u ON u.id = fa.user_id
      WHERE fa.form_id = $1::uuid
        AND fa.org_id = $2::uuid`,
    [input.form.id, input.orgId],
  );

  for (const row of assigned.rows) {
    if (answeredUserIds.has(row.userId)) continue;
    if (remindedToday.has(row.userId)) {
      plan.remindedToday += 1;
      continue;
    }
    plan.noResponse.push({ userId: row.userId, name: row.name, reason: "no_response" });
  }

  return plan;
}

const baseFooter = (orgName: string) =>
  `If money is a problem, say so — there is an option for that on the form, and a mentor at ${orgName} would rather hear it than have you drop out. Nobody is chased for asking.`;

/**
 * The two messages, kept apart on purpose.
 *
 * A person whose own answer says they still owe is told that. A person who
 * never returned the form is told only that — we do not know whether they owe
 * anything, and implying it would be inventing a fact about someone's money.
 */
export function duesReminderBody(input: {
  recipient: DuesRecipient;
  orgName: string;
  formTitle: string;
  href: string;
}): { subject: string; text: string } {
  if (input.recipient.reason === "owing") {
    return {
      subject: `Dues reminder — ${input.orgName}`,
      text: `Your answer on “${input.formTitle}” shows your ${input.orgName} dues as still outstanding.

If that is out of date, update your answer and the reminder stops: ${input.href}

${baseFooter(input.orgName)}`,
    };
  }
  return {
    subject: `We do not have your dues form yet — ${input.orgName}`,
    text: `${input.orgName} has not received your answer to “${input.formTitle}” yet, so the treasurer has no record either way.

Fill it in here: ${input.href}

${baseFooter(input.orgName)}`,
  };
}

/**
 * Send the reminders in a plan.
 *
 * Each recipient's log row is claimed BEFORE the send, exactly like the
 * performance digest, so two treasurers pressing the button at once — or one
 * pressing it twice — cannot chase the same student twice in a day.
 */
export async function sendDuesReminders(
  client: PoolClient,
  input: {
    orgId: string;
    orgName: string;
    formId: string;
    formTitle: string;
    plan: DuesReminderPlan;
    sentBy: string;
    href: string;
    includeNoResponse: boolean;
  },
): Promise<DuesSendResult> {
  const result: DuesSendResult = {
    sent: 0,
    skippedPref: 0,
    alreadyReminded: 0,
    failed: 0,
    assistanceFlagged: input.plan.assistance,
  };

  const recipients = [
    ...input.plan.owing,
    ...(input.includeNoResponse ? input.plan.noResponse : []),
  ];

  for (const recipient of recipients) {
    const claimed = await client.query<{ id: string }>(
      `INSERT INTO dues_reminder_log (org_id, form_id, user_id, kind, status, detail, sent_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'failed', 'claimed', $5::uuid)
       ON CONFLICT (form_id, user_id, sent_on) DO NOTHING
       RETURNING id`,
      [input.orgId, input.formId, recipient.userId, recipient.reason, input.sentBy],
    );
    const claimedId = claimed.rows[0]?.id;
    if (!claimedId) {
      result.alreadyReminded += 1;
      continue;
    }

    const message = duesReminderBody({
      recipient,
      orgName: input.orgName,
      formTitle: input.formTitle,
      href: input.href,
    });

    // A savepoint rather than a plain try/catch. The send touches the database
    // (resolving the recipient), and a swallowed database error leaves the whole
    // transaction aborted — so the UPDATE below, and every remaining recipient,
    // would die with "current transaction is aborted" and the treasurer would
    // lose the log rows for people who had already been emailed.
    const outcome = await withSavepoint(
      client,
      async () => {
        const delivery = await sendDuesReminderEmail(client, {
          userId: recipient.userId,
          subject: message.subject,
          text: message.text,
        });
        if (delivery.status === "sent") return { status: "sent" as const, detail: null };
        if (delivery.status === "skipped") {
          return { status: "skipped_pref" as const, detail: delivery.reason };
        }
        return { status: "failed" as const, detail: delivery.reason };
      },
      { status: "failed" as const, detail: "send failed" },
    );
    const { status, detail } = outcome;

    // Update by the id we just claimed, not by (form, user, CURRENT_DATE): a run
    // that starts a second before midnight would otherwise finalise a row that
    // no longer matches, and quietly leave a "failed / claimed" row behind for a
    // person who was in fact emailed.
    await client.query(
      `UPDATE dues_reminder_log
          SET status = $2, detail = $3, updated_at = now()
        WHERE id = $1::uuid`,
      [claimedId, status, detail],
    );

    if (status === "sent") result.sent += 1;
    else if (status === "skipped_pref") result.skippedPref += 1;
    else result.failed += 1;
  }

  // The people who asked for help still need somebody to act. They get a
  // private nudge to leadership instead of a chasing email to themselves — a
  // count and a link, never a name, because the results page behind org RLS is
  // where a lead should read who, not an inbox that may be shared.
  if (input.plan.assistance > 0) {
    // Guarded for the same reason: the emails have already left, so a failure
    // here must not roll back the log rows that stop them being sent again.
    await withSavepoint(
      client,
      () =>
        client.query(
          `INSERT INTO notifications (user_id, org_id, type, payload)
           SELECT m.user_id, $1::uuid, 'dues_assistance_followup',
                  jsonb_build_object(
                    'title', 'Dues assistance needs a private follow-up',
                    'body', $4::int || ' response(s) on "' || $3::text ||
                            '" asked for financial assistance. They were not emailed. Open the results to follow up.',
                    'formId', $2::uuid,
                    'formTitle', $3::text,
                    'count', $4::int,
                    'href', '/forms/' || $2::text
                  )
             FROM memberships m
            WHERE m.org_id = $1::uuid
              AND m.role IN ('owner', 'admin')`,
          [input.orgId, input.formId, input.formTitle, input.plan.assistance],
        ),
      null,
    );
  }

  return result;
}
