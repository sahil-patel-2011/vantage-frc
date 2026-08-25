import type { PoolClient } from "@neondatabase/serverless";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter } from "@vantage/agent";
import { createBridgeTransport } from "../ai-bridge/transport";
import { meteredAI } from "@vantage/billing";
import { CommitAndThrowError } from "@vantage/db";
import { createEmailProvider, resolveAuthBaseURL } from "@vantage/core";
import {
  buildTranslationPrompt,
  composeParentEmail,
  parseTranslationResponse,
  type TranslatedDigest,
} from "./compose";
import { isEnglish } from "./contacts";
import {
  DIGEST_WINDOW_DAYS,
  buildParentDigest,
  digestPeriod,
  type DigestEvent,
  type ParentDigest,
  type ParentDigestPeriod,
} from "./digest";
import { expandParentViewEvents, type ParentViewRawEvent } from "./view";

/**
 * Shared parent-digest send core. Takes a PoolClient so BOTH callers reuse it:
 *   - request path ("Send digest now"): the withRls client — RLS admits only
 *     owners/admins to parent_contacts, and withRls already runs a transaction,
 *     so meteredAI is invoked directly (transactionalAi: false);
 *   - weekly worker (run-parent-digest.ts): the admin/worker connection, which
 *     is autocommit, so translation wraps meteredAI in its own BEGIN/COMMIT
 *     (transactionalAi: true), mirroring run-performance-email.ts.
 *
 * Honesty rules enforced here:
 *   - an empty week builds no digest: nothing is sent and nothing is logged;
 *   - translated_to is recorded ONLY when a real model translation shipped;
 *   - with email delivery unconfigured every outcome is 'setup_required' —
 *     never a hard failure, never a silent drop;
 *   - every attempted contact outcome lands in parent_digest_sends.
 */

const TRANSLATE_FEATURE = "parent-digest-translate";
const MAX_EVENT_ROWS = 200;

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type EventRow = {
  id: string;
  title: string;
  location: string;
  startsAt: unknown;
  endsAt: unknown;
  rrule: string | null;
  recurrenceEnd: string | null;
  timeZone: string | null;
  exceptions: ParentViewRawEvent["exceptions"];
};

/**
 * Whole-team events (subteam_id IS NULL) in the next 7 days — concrete rows
 * plus recurring series expanded through lib/calendar/recurrence. Per-subteam
 * digest scoping is a deliberate follow-up; nothing here is invented.
 */
export async function loadDigestEvents(
  client: PoolClient,
  orgId: string,
  now: Date,
): Promise<DigestEvent[]> {
  const windowStartIso = now.toISOString();
  const windowEndIso = new Date(
    now.getTime() + DIGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result = await client.query<EventRow>(
    `SELECT e.id::text AS id,
            e.title,
            e.location,
            e.starts_at AS "startsAt",
            e.ends_at AS "endsAt",
            e.rrule,
            e.recurrence_end::text AS "recurrenceEnd",
            e.recurrence_timezone AS "timeZone",
            CASE WHEN e.rrule IS NULL THEN '[]'::jsonb ELSE COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'occurrenceDate', x.occurrence_date,
                'action', x.action
              ) ORDER BY x.occurrence_date)
              FROM calendar_event_exceptions x
              WHERE x.series_id = e.id
            ), '[]'::jsonb) END AS exceptions
     FROM subteam_calendar_events e
     WHERE e.org_id = $1::uuid
       AND e.subteam_id IS NULL
       AND (
         (e.rrule IS NULL AND e.starts_at >= $2::timestamptz AND e.starts_at < $3::timestamptz)
         OR (
           e.rrule IS NOT NULL
           AND e.starts_at < $3::timestamptz
           AND (e.recurrence_end IS NULL OR e.recurrence_end >= ($2::timestamptz)::date)
         )
       )
     ORDER BY e.starts_at
     LIMIT ${MAX_EVENT_ROWS}`,
    [orgId, windowStartIso, windowEndIso],
  );

  const raw: ParentViewRawEvent[] = [];
  for (const row of result.rows) {
    const startsAt = isoOrNull(row.startsAt);
    if (!startsAt) continue;
    raw.push({
      id: row.id,
      title: row.title,
      kind: "",
      location: row.location ?? "",
      startsAt,
      endsAt: isoOrNull(row.endsAt),
      rrule: row.rrule,
      recurrenceEnd: row.recurrenceEnd,
      timeZone: row.timeZone,
      seriesId: null,
      exceptions: row.exceptions ?? [],
      studentRsvp: null,
    });
  }

  return expandParentViewEvents(raw, now, DIGEST_WINDOW_DAYS).map((event) => ({
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: event.location,
  }));
}

/** Build the org's digest for the 7 days from `now`, or null when the week is empty. */
export async function buildOrgDigest(
  client: PoolClient,
  input: {
    orgId: string;
    orgName: string;
    teamNumber: number | null;
    now: Date;
    logisticsNotes?: string | null;
  },
): Promise<{ digest: ParentDigest; period: ParentDigestPeriod } | null> {
  const period = digestPeriod(input.now);
  const events = await loadDigestEvents(client, input.orgId, input.now);
  const digest = buildParentDigest({
    orgName: input.orgName,
    teamNumber: input.teamNumber,
    events,
    logisticsNotes: input.logisticsNotes ?? null,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  });
  return digest ? { digest, period } : null;
}

/** Worker-path metering attribution: the org's owner (then admin, then oldest member). */
export async function resolveMeteredUser(
  client: PoolClient,
  orgId: string,
): Promise<string | null> {
  const owner = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM memberships
     WHERE org_id = $1::uuid
     ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at
     LIMIT 1`,
    [orgId],
  );
  return owner.rows[0]?.userId ?? null;
}

/**
 * Real translation or null — never a fabricated one. ANY failure (no adapter,
 * missing key, billing cap, malformed reply) returns null, and the caller
 * ships the English body with an explicit translation-unavailable note.
 */
async function tryTranslate(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    digest: ParentDigest;
    language: string;
    transactionalAi: boolean;
  },
): Promise<TranslatedDigest | null> {
  try {
    const promptCachingEnabled = await getOrgPromptCachingEnabled(client, input.orgId).catch(
      () => true,
    );
    // Honest feature tag: digest translation is batch work — bridge only under
    // coverage='everything'.
    const adapter = await resolveOrgChatAdapter(client, {
      orgId: input.orgId,
      promptCachingEnabled,
      feature: TRANSLATE_FEATURE,
      bridgeTransport: createBridgeTransport(),
    });
    const prompt = buildTranslationPrompt(input.digest, input.language);

    const invokeMetered = async () => {
      const completion = await meteredAI({
        client,
        orgId: input.orgId,
        userId: input.userId,
        feature: TRANSLATE_FEATURE,
        requestId: crypto.randomUUID(),
        estimatedCostUsd: 0,
        estimatedPromptTokens: Math.ceil(prompt.length / 4),
        estimatedCompletionTokens: Math.ceil(prompt.length / 4),
        provider: adapter.provider,
        model: adapter.model,
        metadata: { language: input.language, path: "parent_digest" },
        invoke: async () => {
          const response = await adapter.complete({
            message: prompt,
            context: [],
            promptCachingEnabled,
          });
          return {
            value: response,
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
            costUsd: response.costUsd,
            model: adapter.model,
            provider: adapter.provider,
            cacheReadInputTokens: response.cacheReadInputTokens,
            cacheWriteInputTokens: response.cacheWriteInputTokens,
            uncachedInputTokens: response.uncachedInputTokens,
          };
        },
      });
      return completion.text;
    };

    let text: string;
    if (input.transactionalAi) {
      // Worker connection is autocommit; meteredAI needs a transaction.
      await client.query("BEGIN");
      try {
        text = await invokeMetered();
        await client.query("COMMIT");
      } catch (error) {
        // meteredAI signals "commit the denial record, then fail" via CommitAndThrowError.
        if (error instanceof CommitAndThrowError) {
          await client.query("COMMIT").catch(() => {});
        } else {
          await client.query("ROLLBACK").catch(() => {});
        }
        throw error;
      }
    } else {
      // Request path: withRls already holds the transaction. A denial record
      // inserted before CommitAndThrowError persists with the outer COMMIT.
      text = await invokeMetered();
    }

    return parseTranslationResponse(text);
  } catch {
    return null;
  }
}

export type ParentDigestOutcome = {
  contactId: string;
  email: string;
  status: "sent" | "skipped" | "failed" | "setup_required";
  reason: string | null;
  translatedTo: string | null;
};

export type ParentDigestOrgSummary = {
  /** False = empty week: nothing sent, nothing logged. */
  digestBuilt: boolean;
  subject: string | null;
  sent: number;
  skipped: number;
  failed: number;
  setupRequired: number;
  outcomes: ParentDigestOutcome[];
};

type ContactRow = {
  id: string;
  email: string;
  preferredLanguage: string;
  digestOptIn: boolean;
  unsubscribeToken: string;
};

async function logSend(
  client: PoolClient,
  input: {
    orgId: string;
    contactId: string;
    subject: string;
    period: ParentDigestPeriod;
    status: ParentDigestOutcome["status"];
    reason: string | null;
    translatedTo: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO parent_digest_sends
       (org_id, contact_id, subject, period_start, period_end, status, reason, translated_to)
     VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::date, $6, $7, $8)`,
    [
      input.orgId,
      input.contactId,
      input.subject,
      input.period.periodStart,
      input.period.periodEnd,
      input.status,
      input.reason,
      input.translatedTo,
    ],
  );
}

/**
 * Build and deliver one org's digest to its active parent contacts.
 * `force: false` (weekly cron) skips contacts that already have a log row for
 * this period, so re-runs never double-send; `force: true` (mentor's explicit
 * "Send digest now") always attempts delivery.
 */
export async function sendParentDigestForOrg(
  client: PoolClient,
  input: {
    orgId: string;
    orgName: string;
    teamNumber: number | null;
    now?: Date;
    logisticsNotes?: string | null;
    /** User charged for translation via meteredAI; null skips translation. */
    meteredUserId: string | null;
    /** True on the autocommit worker connection (see tryTranslate). */
    transactionalAi: boolean;
    force: boolean;
  },
): Promise<ParentDigestOrgSummary> {
  const now = input.now ?? new Date();
  const summary: ParentDigestOrgSummary = {
    digestBuilt: false,
    subject: null,
    sent: 0,
    skipped: 0,
    failed: 0,
    setupRequired: 0,
    outcomes: [],
  };

  const built = await buildOrgDigest(client, {
    orgId: input.orgId,
    orgName: input.orgName,
    teamNumber: input.teamNumber,
    now,
    logisticsNotes: input.logisticsNotes ?? null,
  });
  if (!built) return summary; // empty week — send nothing, log nothing.
  summary.digestBuilt = true;
  summary.subject = built.digest.subject;
  const { digest, period } = built;

  const contacts = await client.query<ContactRow>(
    `SELECT id::text AS id,
            email,
            preferred_language AS "preferredLanguage",
            digest_opt_in AS "digestOptIn",
            unsubscribe_token AS "unsubscribeToken"
     FROM parent_contacts
     WHERE org_id = $1::uuid AND active = true
     ORDER BY lower(email)`,
    [input.orgId],
  );
  if (contacts.rows.length === 0) return summary;

  const provider = createEmailProvider();
  const emailConfigured = provider.name !== "unconfigured";
  const baseUrl = resolveAuthBaseURL();
  const translations = new Map<string, TranslatedDigest | null>();

  for (const contact of contacts.rows) {
    if (!input.force) {
      const already = await client.query(
        `SELECT 1 FROM parent_digest_sends
         WHERE contact_id = $1::uuid AND period_start = $2::date
         LIMIT 1`,
        [contact.id, period.periodStart],
      );
      if (already.rowCount) continue; // this period already recorded — never double-send/log.
    }

    const record = async (
      status: ParentDigestOutcome["status"],
      reason: string | null,
      translatedTo: string | null,
    ) => {
      await logSend(client, {
        orgId: input.orgId,
        contactId: contact.id,
        subject: digest.subject,
        period,
        status,
        reason,
        translatedTo,
      });
      summary.outcomes.push({ contactId: contact.id, email: contact.email, status, reason, translatedTo });
      if (status === "sent") summary.sent += 1;
      else if (status === "skipped") summary.skipped += 1;
      else if (status === "failed") summary.failed += 1;
      else summary.setupRequired += 1;
    };

    if (!contact.digestOptIn) {
      await record("skipped", "unsubscribed", null);
      continue;
    }
    if (!emailConfigured) {
      await record("setup_required", "configure email delivery (RESEND_API_KEY / AUTH_EMAIL_FROM)", null);
      continue;
    }

    // Translate once per language per run; failures cache as null (English + note).
    let translated: TranslatedDigest | null = null;
    if (!isEnglish(contact.preferredLanguage) && input.meteredUserId) {
      if (translations.has(contact.preferredLanguage)) {
        translated = translations.get(contact.preferredLanguage) ?? null;
      } else {
        translated = await tryTranslate(client, {
          orgId: input.orgId,
          userId: input.meteredUserId,
          digest,
          language: contact.preferredLanguage,
          transactionalAi: input.transactionalAi,
        });
        translations.set(contact.preferredLanguage, translated);
      }
    }

    const composed = composeParentEmail({
      digest,
      translated,
      language: contact.preferredLanguage,
      orgName: input.orgName,
      unsubscribeUrl: `${baseUrl}/api/parents/unsubscribe/${contact.unsubscribeToken}`,
    });

    try {
      await provider.sendFreeform({
        to: contact.email,
        subject: composed.subject,
        text: composed.text,
        html: composed.html,
      });
      await record("sent", null, composed.translatedTo);
    } catch (error) {
      await record(
        "failed",
        error instanceof Error ? error.message.slice(0, 300) : "send failed",
        null,
      );
    }
  }

  return summary;
}
