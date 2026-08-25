import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";
import {
  parseSourceCounts,
  type DreamJournalEntry,
  type DreamJournalPage,
  type DreamRunKind,
  type DreamRunStatus,
} from "../../../lib/dreaming/journal";
import { runTeamDream } from "../../../lib/dreaming/run-dream";

/**
 * Team journal — the readable face of nightly dreaming (docs/DREAMING.md).
 *
 * GET  reads this org's `team_dream_runs` ledger joined to the `team_memories`
 *      row each run wrote, newest first, paged a whole day at a time. Every
 *      read goes through withRls, so a member only ever sees their own org's
 *      journal; org content never crosses a tenant boundary here.
 * POST re-runs today for THIS org only. It requires an authenticated
 *      owner/admin — deliberately NOT the cron secret, which stays a
 *      machine-only credential for the scheduled sweep.
 *
 * Nothing is synthesised: a day without a run row simply has no entry, and a
 * run that wrote no memory shows its honest status instead of prose.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_PAGE_DAYS = 21;
const MAX_PAGE_DAYS = 60;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Manual re-runs cost the team's own AI credits — keep a hand off the button. */
const MANUAL_RUN_COOLDOWN_SECONDS = 300;

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw Object.assign(new Error("Authentication required"), { status: 401 });
  return value;
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Team journal request failed";
  const status =
    typeof error === "object" && error && "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : 400;
  return Response.json({ error: message }, { status });
}

async function assertMember(client: PoolClient, orgId: string, userId: string): Promise<string> {
  const membership = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, userId],
  );
  const role = membership.rows[0]?.role;
  if (!role) {
    throw Object.assign(new Error("Join this team to read its journal"), { status: 403 });
  }
  return role;
}

async function ledgerPresent(client: PoolClient): Promise<boolean> {
  const present = await client.query<{ present: boolean }>(
    `SELECT to_regclass('public.team_dream_runs') IS NOT NULL AS present`,
    [],
  );
  return present.rows[0]?.present ?? false;
}

type MemorySettings = { enabled: boolean; retentionDays: number };

async function readMemorySettings(client: PoolClient, orgId: string): Promise<MemorySettings> {
  const settings = await client.query<MemorySettings>(
    `SELECT COALESCE(enabled, false) AS enabled,
            COALESCE(retention_days, 365)::int AS "retentionDays"
     FROM team_memory_settings WHERE org_id = $1::uuid`,
    [orgId],
  );
  // No row yet = team memory was never turned on. Report that honestly rather
  // than implying a policy the owner has not chosen.
  return settings.rows[0] ?? { enabled: false, retentionDays: 365 };
}

type LedgerRow = {
  day: string;
  kind: DreamRunKind;
  status: DreamRunStatus;
  ranAt: string;
  errorClass: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  sourceCounts: unknown;
  content: string | null;
  memoryLive: boolean;
};

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId || !UUID_PATTERN.test(orgId)) {
      throw Object.assign(new Error("orgId is required"), { status: 400 });
    }
    const before = url.searchParams.get("before");
    if (before && !ISO_DAY.test(before)) {
      throw Object.assign(new Error("before must be YYYY-MM-DD"), { status: 400 });
    }
    const requested = Number(url.searchParams.get("days") ?? DEFAULT_PAGE_DAYS);
    const pageDays = Number.isFinite(requested)
      ? Math.min(MAX_PAGE_DAYS, Math.max(1, Math.trunc(requested)))
      : DEFAULT_PAGE_DAYS;

    const page = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const role = await assertMember(client, orgId, current.user.id);
      const canRunNow = role === "owner" || role === "admin";
      const settings = await readMemorySettings(client, orgId);

      if (!(await ledgerPresent(client))) {
        // Ledger not migrated yet — an empty journal, never a crash.
        const empty: DreamJournalPage = {
          entries: [],
          nextCursor: null,
          retentionDays: settings.retentionDays,
          memoryEnabled: settings.enabled,
          canRunNow,
          lastRunAt: null,
        };
        return empty;
      }

      // Page a whole DAY at a time: Saturday carries both its nightly entry and
      // the week roll-up, and a cursor that split them would drop one silently.
      const rows = await client.query<LedgerRow>(
        `WITH page_days AS (
           SELECT DISTINCT day FROM team_dream_runs
           WHERE org_id = $1::uuid AND ($2::date IS NULL OR day < $2::date)
           ORDER BY day DESC
           LIMIT $3::int
         )
         SELECT r.day::text AS day,
                r.kind,
                r.status,
                r.ran_at::text AS "ranAt",
                r.error_class AS "errorClass",
                r.tokens_in AS "tokensIn",
                r.tokens_out AS "tokensOut",
                r.source_counts AS "sourceCounts",
                m.content,
                COALESCE(
                  m.id IS NOT NULL AND m.disabled_at IS NULL
                    AND (m.expires_at IS NULL OR m.expires_at > now()),
                  false
                ) AS "memoryLive"
         FROM team_dream_runs r
         JOIN page_days d ON d.day = r.day
         LEFT JOIN team_memories m
           ON m.id = r.memory_id AND m.org_id = r.org_id AND m.source = 'dream'
         WHERE r.org_id = $1::uuid
         ORDER BY r.day DESC, r.kind DESC`,
        [orgId, before ?? null, pageDays + 1],
      );

      const days = [...new Set(rows.rows.map((row) => row.day))];
      const keptDays = new Set(days.slice(0, pageDays));
      const nextCursor = days.length > pageDays ? days[pageDays - 1]! : null;

      const entries: DreamJournalEntry[] = rows.rows
        .filter((row) => keptDays.has(row.day))
        .map((row) => ({
          day: row.day,
          kind: row.kind,
          status: row.status,
          ranAt: row.ranAt,
          // Expired or disabled memories are gone from prompts, so the journal
          // must not keep showing their text as if it were still in play.
          content: row.memoryLive ? row.content : null,
          memoryLive: row.memoryLive,
          errorClass: row.errorClass,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          sourceCounts: parseSourceCounts(row.sourceCounts),
        }));

      const last = await client.query<{ ranAt: string | null }>(
        `SELECT max(ran_at)::text AS "ranAt" FROM team_dream_runs WHERE org_id = $1::uuid`,
        [orgId],
      );

      const result: DreamJournalPage = {
        entries,
        nextCursor,
        retentionDays: settings.retentionDays,
        memoryEnabled: settings.enabled,
        canRunNow,
        lastRunAt: last.rows[0]?.ranAt ?? null,
      };
      return result;
    });

    return Response.json(page);
  } catch (error) {
    return fail(error);
  }
}

/**
 * "Run tonight's dream now" for one org. Owner/admin only, cooldown-guarded,
 * and scoped to the caller's own org — the worker sweep it delegates to is
 * given nothing but that verified org id.
 */
export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json().catch(() => ({}))) as { orgId?: unknown };
    const orgId = typeof body.orgId === "string" ? body.orgId : "";
    if (!UUID_PATTERN.test(orgId)) {
      throw Object.assign(new Error("orgId is required"), { status: 400 });
    }

    await withRls({ userId: current.user.id, orgId }, async (client) => {
      const role = await assertMember(client, orgId, current.user.id);
      if (role !== "owner" && role !== "admin") {
        throw Object.assign(new Error("Owner or admin access required to run a dream"), {
          status: 403,
        });
      }
      const settings = await readMemorySettings(client, orgId);
      if (!settings.enabled) {
        throw Object.assign(
          new Error("Turn on team memory below before running a dream — disabled teams are skipped."),
          { status: 409 },
        );
      }
      if (await ledgerPresent(client)) {
        const recent = await client.query<{ seconds: number }>(
          `SELECT extract(epoch FROM (now() - max(ran_at)))::int AS seconds
           FROM team_dream_runs
           WHERE org_id = $1::uuid AND day = (now() AT TIME ZONE 'utc')::date`,
          [orgId],
        );
        const seconds = recent.rows[0]?.seconds;
        if (typeof seconds === "number" && seconds < MANUAL_RUN_COOLDOWN_SECONDS) {
          throw Object.assign(
            new Error(
              `Today's dream just ran. Try again in ${Math.ceil(
                (MANUAL_RUN_COOLDOWN_SECONDS - seconds) / 60,
              )} min.`,
            ),
            { status: 429 },
          );
        }
      }
    });

    // Outside the RLS transaction: the sweep opens its own worker connection,
    // and it is handed nothing but the org id we just authorised.
    const summary = await runTeamDream({ orgId });
    return Response.json({ summary });
  } catch (error) {
    return fail(error);
  }
}
