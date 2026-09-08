/**
 * My Kit loader — read-only fusion over surfaces that already own their data.
 *
 * Design rules (mirrors `lib/roadmap/load-roadmap.ts` and `lib/load-my-day.ts`):
 *   - My Kit owns NO tables and performs NO writes. Every query is a SELECT.
 *   - Every optional table is checked with `to_regclass` first, so a database that
 *     never ran a given migration renders "not on this deployment" instead of a 500.
 *   - Each read is additionally wrapped so a column drift in a table this module does
 *     not own degrades that one section to empty rather than failing the page.
 *   - Nothing is invented. Empty stays empty.
 *
 * Name-matched sources: `build_tasks.assignee`, `safety_certifications.person_name`, and
 * `tool_checkout_loans.borrower_name` are free text in the tables that own them, so we
 * match them case-insensitively against the member's display name. When a member has no
 * display name we skip those reads entirely rather than matching everyone's blank string.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { TRACK_BY_KEY } from "../role-onboarding/tracks";
import { EMPTY_AVAILABILITY, composeMyKit, myKitSetupRequired } from "./compose";
import type {
  MyKitAvailability,
  MyKitCertificationRecord,
  MyKitDutyRecord,
  MyKitEventRecord,
  MyKitHourLogRecord,
  MyKitLearningRecord,
  MyKitMediaRecord,
  MyKitMoneyRecord,
  MyKitOnboardingRecord,
  MyKitPackingRecord,
  MyKitScoutAccuracyRecord,
  MyKitScoutAssignmentRecord,
  MyKitSkillRecord,
  MyKitTaskRecord,
  MyKitToolLoanRecord,
  MyKitView,
} from "./types";

/** Tables My Kit reads but does not own. Presence is probed, never assumed. */
export const MY_KIT_OPTIONAL_TABLES = [
  "build_tasks",
  "build_task_assignees",
  "team_todos",
  "team_subteams",
  "team_subteam_members",
  "subteam_calendar_events",
  "subteam_calendar_rsvps",
  "duty_assignments",
  "scout_assignments",
  "scout_accuracy_snapshots",
  "media_content_items",
  "hour_logs",
  "learning_predictions",
  "skills_graph_entries",
  "safety_certifications",
  "tool_checkout_tools",
  "tool_checkout_loans",
  "purchase_requests",
  // Lands with migration 0482 in a parallel wave — guarded on purpose.
  "reimbursement_requests",
  "member_onboarding_tracks",
  "member_onboarding_checks",
  "packing_lists",
  "packing_items",
  "packing_requests",
] as const;

export type MyKitOptionalTable = (typeof MY_KIT_OPTIONAL_TABLES)[number];

export async function presentTables(client: PoolClient): Promise<Set<MyKitOptionalTable>> {
  try {
    const result = await client.query<{ name: MyKitOptionalTable }>(
      `SELECT t.name FROM unnest($1::text[]) AS t(name)
       WHERE to_regclass('public.' || t.name) IS NOT NULL`,
      [[...MY_KIT_OPTIONAL_TABLES]],
    );
    return new Set(result.rows.map((row) => row.name));
  } catch {
    return new Set<MyKitOptionalTable>();
  }
}

/**
 * Numeric text from a jsonb/numeric column, or null. Deliberately NOT `Number(x)`:
 * `Number(null)` and `Number("")` are both 0, and a fabricated zero reads as a real
 * measurement to the person looking at it.
 */
export function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Callers fan the section reads out with Promise.all, but they all share one
 * PoolClient, so the statements are serialized by the driver anyway. Savepoints
 * are not: interleaved `SAVEPOINT a … SAVEPOINT b … RELEASE a` destroys b, so
 * each protected read takes its turn on a per-client queue.
 */
const optionalReadQueues = new WeakMap<PoolClient, Promise<unknown>>();

function queued<T>(client: PoolClient, run: () => Promise<T>): Promise<T> {
  const previous = optionalReadQueues.get(client) ?? Promise.resolve();
  const next = previous.then(run, run);
  optionalReadQueues.set(
    client,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/**
 * A failed optional read degrades one section to empty; it never fails the page.
 *
 * The try/catch alone was not enough: withRls runs the whole request inside one
 * transaction, so a rejected statement puts Postgres in the aborted state and
 * every *later* section fails with "current transaction is aborted" — a single
 * bad column blanked most of My Kit rather than one card. Each optional read now
 * runs inside its own savepoint, so only that statement rolls back.
 */
async function safely<T>(client: PoolClient, run: () => Promise<T[]>): Promise<T[]> {
  return queued(client, async () => {
    const name = `my_kit_optional`;
    try {
      await client.query(`SAVEPOINT ${name}`);
    } catch {
      // No transaction to protect (or already unusable) — fall back to a plain try.
      try {
        return await run();
      } catch {
        return [];
      }
    }
    try {
      const rows = await run();
      await client.query(`RELEASE SAVEPOINT ${name}`);
      return rows;
    } catch {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await client.query(`RELEASE SAVEPOINT ${name}`);
      } catch {
        // Connection is gone; the caller's withRls will roll the request back.
      }
      return [];
    }
  });
}

type OrgRow = {
  orgId: string;
  orgName: string;
  teamNumber: number | null;
  orgRole: string;
  teamRole: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  userName: string | null;
};

export async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<OrgRow | null> {
  const result = await client.query<OrgRow>(
    `SELECT m.org_id::text AS "orgId",
            o.name AS "orgName",
            o.team_number AS "teamNumber",
            m.role::text AS "orgRole",
            p.team_role AS "teamRole",
            p.display_name AS "displayName",
            p.first_name AS "firstName",
            p.last_name AS "lastName",
            u.name AS "userName"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN profiles p ON p.user_id = m.user_id
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.user_id = $1::uuid
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

/** The name the rest of the app would have typed into a free-text assignee field. */
export function displayNameFor(row: OrgRow): string {
  const parts = [row.firstName, row.lastName].filter((part) => (part ?? "").trim().length > 0);
  return (
    (row.displayName ?? "").trim() ||
    parts.join(" ").trim() ||
    (row.userName ?? "").trim()
  );
}

function availabilityFrom(present: Set<MyKitOptionalTable>): MyKitAvailability {
  return {
    ...EMPTY_AVAILABILITY,
    tasks: present.has("build_tasks") || present.has("team_todos"),
    packing: present.has("packing_lists") && present.has("packing_items"),
    calendar: present.has("subteam_calendar_events"),
    duties: present.has("duty_assignments"),
    scouting: present.has("scout_assignments"),
    media: present.has("media_content_items"),
    hours: present.has("hour_logs"),
    learning: present.has("learning_predictions"),
    skills: present.has("skills_graph_entries") || present.has("safety_certifications"),
    tools: present.has("tool_checkout_loans") && present.has("tool_checkout_tools"),
    money: present.has("purchase_requests") || present.has("reimbursement_requests"),
    onboarding: present.has("member_onboarding_tracks"),
  };
}

// ---------------------------------------------------------------------------
// Per-section reads
// ---------------------------------------------------------------------------

async function loadSubteams(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
): Promise<Array<{ id: string; name: string }>> {
  if (!present.has("team_subteams") || !present.has("team_subteam_members")) return [];
  return safely(client, async () => {
    const result = await client.query<{ id: string; name: string }>(
      `SELECT s.id::text AS id, s.name
       FROM team_subteam_members m
       JOIN team_subteams s ON s.id = m.subteam_id
       WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid
       ORDER BY s.sort_order, s.name`,
      [orgId, userId],
    );
    return result.rows;
  });
}

async function loadTasks(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
  displayName: string,
): Promise<MyKitTaskRecord[]> {
  const out: MyKitTaskRecord[] = [];

  if (present.has("build_tasks") && displayName) {
    const rows = await safely(client, async () => {
      const result = await client.query<{
        id: string;
        title: string;
        status: string;
        context: string | null;
        dueOn: string | null;
        priority: string | null;
      }>(
        `SELECT t.id::text AS id, t.title, t.status, t.subsystem AS context,
                t.due_on::text AS "dueOn", t.priority
         FROM build_tasks t
         WHERE t.org_id = $1::uuid
           AND t.status IN ('todo', 'in_progress', 'blocked')
           AND lower(btrim(coalesce(t.assignee, ''))) = lower(btrim($2::text))
         ORDER BY t.due_on NULLS LAST, t.created_at
         LIMIT 12`,
        [orgId, displayName],
      );
      return result.rows;
    });
    for (const row of rows) {
      out.push({
        id: row.id,
        source: "build_task",
        title: row.title,
        status: row.status,
        context: row.context ?? "",
        dueOn: row.dueOn,
        priority: row.priority,
      });
    }

    if (present.has("build_task_assignees")) {
      const extra = await safely(client, async () => {
        const result = await client.query<{
          id: string;
          title: string;
          status: string;
          context: string | null;
          dueOn: string | null;
          priority: string | null;
        }>(
          `SELECT t.id::text AS id, t.title, t.status, t.subsystem AS context,
                  t.due_on::text AS "dueOn", t.priority
           FROM build_task_assignees a
           JOIN build_tasks t ON t.id = a.task_id
           WHERE a.org_id = $1::uuid
             AND t.status IN ('todo', 'in_progress', 'blocked')
             AND lower(btrim(a.assignee)) = lower(btrim($2::text))
           ORDER BY t.due_on NULLS LAST, t.created_at
           LIMIT 12`,
          [orgId, displayName],
        );
        return result.rows;
      });
      for (const row of extra) {
        if (out.some((task) => task.source === "build_task" && task.id === row.id)) continue;
        out.push({
          id: row.id,
          source: "build_task",
          title: row.title,
          status: row.status,
          context: row.context ?? "",
          dueOn: row.dueOn,
          priority: row.priority,
        });
      }
    }
  }

  if (present.has("team_todos")) {
    const rows = await safely(client, async () => {
      const result = await client.query<{
        id: string;
        title: string;
        status: string;
        context: string | null;
        dueOn: string | null;
      }>(
        `SELECT t.id::text AS id, t.title, t.status,
                ${present.has("team_subteams") ? "s.name" : "NULL::text"} AS context,
                t.due_on::text AS "dueOn"
         FROM team_todos t
         ${present.has("team_subteams") ? "LEFT JOIN team_subteams s ON s.id = t.subteam_id" : ""}
         WHERE t.org_id = $1::uuid
           AND t.assignee_user_id = $2::uuid
           AND t.status <> 'done'
         ORDER BY t.due_on NULLS LAST, t.created_at
         LIMIT 12`,
        [orgId, userId],
      );
      return result.rows;
    });
    for (const row of rows) {
      out.push({
        id: row.id,
        source: "todo",
        title: row.title,
        status: row.status,
        context: row.context ?? "",
        dueOn: row.dueOn,
        priority: null,
      });
    }
  }

  return out;
}

async function loadEvents(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
  subteamIds: string[],
): Promise<MyKitEventRecord[]> {
  if (!present.has("subteam_calendar_events")) return [];
  const withRsvp = present.has("subteam_calendar_rsvps");
  const withNames = present.has("team_subteams");
  return safely(client, async () => {
    const result = await client.query<{
      id: string;
      title: string;
      kind: string;
      startsAt: string;
      location: string | null;
      subteamName: string | null;
      rsvp: string | null;
    }>(
      `SELECT e.id::text AS id, e.title, e.kind, e.starts_at::text AS "startsAt", e.location,
              ${withNames ? "s.name" : "NULL::text"} AS "subteamName",
              ${withRsvp ? "r.response" : "NULL::text"} AS rsvp
       FROM subteam_calendar_events e
       ${withNames ? "LEFT JOIN team_subteams s ON s.id = e.subteam_id" : ""}
       ${withRsvp ? "LEFT JOIN subteam_calendar_rsvps r ON r.event_id = e.id AND r.user_id = $2::uuid" : ""}
       WHERE e.org_id = $1::uuid
         AND e.starts_at >= now() - interval '2 hours'
         AND (e.subteam_id IS NULL OR e.subteam_id = ANY($3::uuid[]))
       ORDER BY e.starts_at
       LIMIT 8`,
      [orgId, userId, subteamIds],
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      startsAt: row.startsAt,
      location: row.location ?? "",
      subteamName: row.subteamName ?? "",
      rsvp: row.rsvp,
    }));
  });
}

async function loadDuties(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
): Promise<MyKitDutyRecord[]> {
  if (!present.has("duty_assignments")) return [];
  return safely(client, async () => {
    const result = await client.query<{
      id: string;
      title: string;
      kind: string;
      startsAt: string;
      notes: string | null;
    }>(
      `SELECT id::text AS id, title, kind, starts_at::text AS "startsAt", notes
       FROM duty_assignments
       WHERE org_id = $1::uuid
         AND assigned_user_id = $2::uuid
         AND starts_at >= now() - interval '2 hours'
       ORDER BY starts_at
       LIMIT 8`,
      [orgId, userId],
    );
    return result.rows.map((row) => ({ ...row, notes: row.notes ?? "" }));
  });
}

async function loadScoutAssignments(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
): Promise<MyKitScoutAssignmentRecord[]> {
  if (!present.has("scout_assignments")) return [];
  return safely(client, async () => {
    const result = await client.query<MyKitScoutAssignmentRecord>(
      `SELECT id::text AS id, event_key AS "eventKey", match_key AS "matchKey",
              team_key AS "teamKey", role, starts_at::text AS "startsAt"
       FROM scout_assignments
       WHERE org_id = $1::uuid AND user_id = $2::uuid
       ORDER BY starts_at NULLS LAST, match_key
       LIMIT 10`,
      [orgId, userId],
    );
    return result.rows;
  });
}

async function loadScoutAccuracy(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
): Promise<MyKitScoutAccuracyRecord | null> {
  if (!present.has("scout_accuracy_snapshots")) return null;
  const rows = await safely(client, async () => {
    const result = await client.query<{
      eventKey: string;
      scoutsScored: number;
      computedAt: string;
      entriesScored: string | null;
      accuracyScore: string | null;
      rank: string | null;
    }>(
      `SELECT s.event_key AS "eventKey", s.scouts_scored AS "scoutsScored",
              s.computed_at::text AS "computedAt",
              e->>'entriesScored' AS "entriesScored",
              e->>'accuracyScore' AS "accuracyScore",
              e->>'rank' AS "rank"
       FROM scout_accuracy_snapshots s
       CROSS JOIN LATERAL jsonb_array_elements(s.scores) AS e
       WHERE s.org_id = $1::uuid AND e->>'scoutUserId' = $2::text
       ORDER BY s.computed_at DESC
       LIMIT 1`,
      [orgId, userId],
    );
    return result.rows;
  });
  const row = rows[0];
  if (!row) return null;
  // Number(null) is 0, which would render a confident "Accuracy 0%" for a scout who
  // was never scored. An absent score means "unscored", so the row is dropped.
  const score = numberOrNull(row.accuracyScore);
  if (score == null) return null;
  return {
    eventKey: row.eventKey,
    entriesScored: numberOrNull(row.entriesScored) ?? 0,
    accuracyScore: score,
    rank: numberOrNull(row.rank),
    scoutsScored: row.scoutsScored,
    computedAt: row.computedAt,
  };
}

async function loadMedia(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
): Promise<MyKitMediaRecord[]> {
  if (!present.has("media_content_items")) return [];
  return safely(client, async () => {
    const result = await client.query<MyKitMediaRecord>(
      `SELECT id::text AS id, title, platform, status, due_at::text AS "dueAt"
       FROM media_content_items
       WHERE org_id = $1::uuid
         AND assigned_to = $2::uuid
         AND status IN ('draft', 'scheduled')
       ORDER BY due_at NULLS LAST, created_at DESC
       LIMIT 8`,
      [orgId, userId],
    );
    return result.rows;
  });
}

async function loadHourLogs(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
): Promise<MyKitHourLogRecord[]> {
  if (!present.has("hour_logs")) return [];
  return safely(client, async () => {
    const result = await client.query<MyKitHourLogRecord>(
      `SELECT id::text AS id, kind, clock_in::text AS "clockIn", clock_out::text AS "clockOut"
       FROM hour_logs
       WHERE org_id = $1::uuid AND user_id = $2::uuid
       ORDER BY clock_in DESC
       LIMIT 400`,
      [orgId, userId],
    );
    return result.rows;
  });
}

async function loadLearning(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
): Promise<MyKitLearningRecord | null> {
  if (!present.has("learning_predictions")) return null;
  const rows = await safely(client, async () => {
    const result = await client.query<{
      total: number;
      spotOn: number;
      close: number;
      off: number;
      skipped: number;
      lastAt: string | null;
    }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE closeness = 'spot-on')::int AS "spotOn",
              count(*) FILTER (WHERE closeness = 'close')::int AS close,
              count(*) FILTER (WHERE closeness = 'off')::int AS off,
              count(*) FILTER (WHERE skipped)::int AS skipped,
              max(created_at)::text AS "lastAt"
       FROM learning_predictions
       WHERE org_id = $1::uuid AND user_id = $2::uuid`,
      [orgId, userId],
    );
    return result.rows;
  });
  const row = rows[0];
  if (!row || row.total === 0) return null;
  return row;
}

async function loadSkills(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
): Promise<MyKitSkillRecord[]> {
  if (!present.has("skills_graph_entries")) return [];
  return safely(client, async () => {
    const result = await client.query<MyKitSkillRecord>(
      `SELECT id::text AS id,
              COALESCE(NULLIF(btrim(custom_label), ''), skill_category) AS label,
              proficiency
       FROM skills_graph_entries
       WHERE org_id = $1::uuid AND user_id = $2::uuid
       ORDER BY created_at DESC
       LIMIT 12`,
      [orgId, userId],
    );
    return result.rows;
  });
}

async function loadCertifications(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  displayName: string,
): Promise<MyKitCertificationRecord[]> {
  if (!present.has("safety_certifications") || !displayName) return [];
  return safely(client, async () => {
    const result = await client.query<MyKitCertificationRecord>(
      `SELECT id::text AS id, cert_type AS "certType",
              completed_on::text AS "completedOn", expires_on::text AS "expiresOn"
       FROM safety_certifications
       WHERE org_id = $1::uuid
         AND lower(btrim(person_name)) = lower(btrim($2::text))
       ORDER BY completed_on DESC
       LIMIT 12`,
      [orgId, displayName],
    );
    return result.rows;
  });
}

async function loadTools(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  displayName: string,
): Promise<MyKitToolLoanRecord[]> {
  if (!present.has("tool_checkout_loans") || !present.has("tool_checkout_tools")) return [];
  if (!displayName) return [];
  return safely(client, async () => {
    const result = await client.query<MyKitToolLoanRecord>(
      `SELECT l.id::text AS id, t.name AS "toolName",
              l.checked_out_at::text AS "checkedOutAt", l.due_at::text AS "dueAt"
       FROM tool_checkout_loans l
       JOIN tool_checkout_tools t ON t.id = l.tool_id
       WHERE l.org_id = $1::uuid
         AND l.returned_at IS NULL
         AND lower(btrim(l.borrower_name)) = lower(btrim($2::text))
       ORDER BY l.due_at NULLS LAST, l.checked_out_at
       LIMIT 10`,
      [orgId, displayName],
    );
    return result.rows;
  });
}

async function loadMoney(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
): Promise<MyKitMoneyRecord[]> {
  const out: MyKitMoneyRecord[] = [];

  if (present.has("purchase_requests")) {
    const rows = await safely(client, async () => {
      const result = await client.query<{
        id: string;
        title: string;
        status: string;
        amountUsd: string | null;
        createdAt: string | null;
      }>(
        `SELECT id::text AS id, title, status::text AS status,
                total_cost_usd::text AS "amountUsd", created_at::text AS "createdAt"
         FROM purchase_requests
         WHERE org_id = $1::uuid
           AND requested_by = $2::uuid
           AND status::text IN ('pending', 'approved', 'ordered')
         ORDER BY created_at DESC
         LIMIT 8`,
        [orgId, userId],
      );
      return result.rows;
    });
    for (const row of rows) {
      out.push({
        id: row.id,
        source: "purchase_request",
        title: row.title,
        status: row.status,
        amountUsd: numberOrNull(row.amountUsd),
        createdAt: row.createdAt,
      });
    }
  }

  // Migration 0482 (reimbursements) lands in a parallel wave. We probe the table and
  // read only the columns every plausible shape has; anything else stays out rather
  // than being guessed at. A shape we cannot read yields an empty — never a placeholder.
  if (present.has("reimbursement_requests")) {
    const rows = await safely(client, async () => {
      const result = await client.query<{
        id: string;
        status: string;
        createdAt: string | null;
      }>(
        `SELECT id::text AS id, status::text AS status, created_at::text AS "createdAt"
         FROM reimbursement_requests
         WHERE org_id = $1::uuid AND member_user_id = $2::uuid
         ORDER BY created_at DESC
         LIMIT 8`,
        [orgId, userId],
      );
      return result.rows;
    });
    for (const row of rows) {
      out.push({
        id: row.id,
        source: "reimbursement",
        title: "Reimbursement request",
        status: row.status,
        amountUsd: null,
        createdAt: row.createdAt,
      });
    }
  }

  return out;
}

async function loadOnboarding(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
): Promise<MyKitOnboardingRecord[]> {
  if (!present.has("member_onboarding_tracks")) return [];
  const withChecks = present.has("member_onboarding_checks");
  const rows = await safely(client, async () => {
    const result = await client.query<{ trackKey: string; done: number }>(
      `SELECT t.track_key AS "trackKey",
              ${
                withChecks
                  ? `(SELECT count(*)::int FROM member_onboarding_checks c
                      WHERE c.org_id = t.org_id AND c.user_id = t.user_id
                        AND c.track_key = t.track_key)`
                  : "0"
              } AS done
       FROM member_onboarding_tracks t
       WHERE t.org_id = $1::uuid AND t.user_id = $2::uuid AND t.dismissed_at IS NULL
       ORDER BY t.assigned_at
       LIMIT 10`,
      [orgId, userId],
    );
    return result.rows;
  });

  const out: MyKitOnboardingRecord[] = [];
  for (const row of rows) {
    const template = TRACK_BY_KEY[row.trackKey];
    if (!template) continue;
    const total = template.checks.length;
    out.push({
      trackKey: row.trackKey,
      title: template.title,
      done: Math.min(row.done, total),
      total,
    });
  }
  // Finished tracks are not "what I need right now"; keep them out unless nothing is open.
  const open = out.filter((track) => track.done < track.total);
  return open.length > 0 ? open : out.slice(0, 1);
}

/**
 * Personal packing only.
 *
 * A member owns a row when they requested it, they were assigned it
 * (`assigned_user_id`), or they packed it. `created_by` is ignored on purpose:
 * seeding the standard competition template stamps the list creator on every
 * item, and treating that as "their kit" would render a DEMO load-out as if it
 * were assigned to them. Unassigned master-list rows stay off My Kit.
 */
async function loadPacking(
  client: PoolClient,
  present: Set<MyKitOptionalTable>,
  orgId: string,
  userId: string,
): Promise<MyKitPackingRecord[]> {
  if (!present.has("packing_lists") || !present.has("packing_items")) return [];

  const out: MyKitPackingRecord[] = [];
  const seenItem = new Set<string>();

  if (present.has("packing_requests")) {
    const requests = await safely(client, async () => {
      const result = await client.query<{
        id: string;
        listId: string;
        listTitle: string;
        eventKey: string | null;
        category: string;
        label: string;
        quantity: number;
        status: "pending" | "accepted" | "packed";
        packed: boolean | null;
        itemId: string | null;
      }>(
        `SELECT r.id::text AS id, r.list_id::text AS "listId", l.title AS "listTitle",
                l.event_key AS "eventKey", r.category, r.label, r.quantity,
                r.status, i.packed, i.id::text AS "itemId"
         FROM packing_requests r
         JOIN packing_lists l ON l.id = r.list_id
         LEFT JOIN packing_items i ON i.id = r.packing_item_id
         WHERE r.org_id = $1::uuid
           AND r.requested_by = $2::uuid
           AND r.status IN ('pending', 'accepted')
         ORDER BY r.created_at DESC
         LIMIT 20`,
        [orgId, userId],
      );
      return result.rows;
    });
    for (const row of requests) {
      const packed = Boolean(row.packed);
      if (row.itemId) seenItem.add(row.itemId);
      out.push({
        id: row.id,
        source: "request",
        listId: row.listId,
        listTitle: row.listTitle,
        eventKey: row.eventKey,
        category: row.category,
        label: row.label,
        quantity: row.quantity,
        status: packed ? "packed" : row.status,
        packed,
      });
    }
  }

  const assignedToMe = await safely(client, async () => {
    const result = await client.query<{
      id: string;
      listId: string;
      listTitle: string;
      eventKey: string | null;
      category: string;
      label: string;
      quantity: number;
      packed: boolean;
    }>(
      `SELECT i.id::text AS id, i.list_id::text AS "listId", l.title AS "listTitle",
              l.event_key AS "eventKey", i.category, i.label, i.quantity, i.packed
       FROM packing_items i
       JOIN packing_lists l ON l.id = i.list_id
       WHERE i.org_id = $1::uuid
         AND i.assigned_user_id = $2::uuid
       ORDER BY i.packed ASC, i.created_at DESC
       LIMIT 20`,
      [orgId, userId],
    );
    return result.rows;
  });
  for (const row of assignedToMe) {
    if (seenItem.has(row.id)) continue;
    seenItem.add(row.id);
    const packed = Boolean(row.packed);
    out.push({
      id: row.id,
      source: packed ? "packed" : "request",
      listId: row.listId,
      listTitle: row.listTitle,
      eventKey: row.eventKey,
      category: row.category,
      label: row.label,
      quantity: row.quantity,
      status: packed ? "packed" : "accepted",
      packed,
    });
  }

  const packedByMe = await safely(client, async () => {
    const result = await client.query<{
      id: string;
      listId: string;
      listTitle: string;
      eventKey: string | null;
      category: string;
      label: string;
      quantity: number;
    }>(
      `SELECT i.id::text AS id, i.list_id::text AS "listId", l.title AS "listTitle",
              l.event_key AS "eventKey", i.category, i.label, i.quantity
       FROM packing_items i
       JOIN packing_lists l ON l.id = i.list_id
       WHERE i.org_id = $1::uuid
         AND i.packed_by = $2::uuid
         AND i.packed
       ORDER BY i.packed_at DESC NULLS LAST
       LIMIT 20`,
      [orgId, userId],
    );
    return result.rows;
  });
  for (const row of packedByMe) {
    if (seenItem.has(row.id)) continue;
    out.push({
      id: row.id,
      source: "packed",
      listId: row.listId,
      listTitle: row.listTitle,
      eventKey: row.eventKey,
      category: row.category,
      label: row.label,
      quantity: row.quantity,
      status: "packed",
      packed: true,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function loadMyKit(
  client: PoolClient,
  input: { userId: string; orgId?: string | null; now?: Date },
): Promise<MyKitView> {
  const org = await resolveOrg(client, input.userId, input.orgId ?? null);
  if (!org) return myKitSetupRequired(null);

  const present = await presentTables(client);
  const displayName = displayNameFor(org);
  const subteams = await loadSubteams(client, present, org.orgId, input.userId);
  const subteamIds = subteams.map((entry) => entry.id);

  const [
    tasks,
    events,
    duties,
    scoutAssignments,
    scoutAccuracy,
    media,
    hourLogs,
    learning,
    skills,
    certifications,
    tools,
    money,
    onboarding,
    packing,
  ] = await Promise.all([
    loadTasks(client, present, org.orgId, input.userId, displayName),
    loadEvents(client, present, org.orgId, input.userId, subteamIds),
    loadDuties(client, present, org.orgId, input.userId),
    loadScoutAssignments(client, present, org.orgId, input.userId),
    loadScoutAccuracy(client, present, org.orgId, input.userId),
    loadMedia(client, present, org.orgId, input.userId),
    loadHourLogs(client, present, org.orgId, input.userId),
    loadLearning(client, present, org.orgId, input.userId),
    loadSkills(client, present, org.orgId, input.userId),
    loadCertifications(client, present, org.orgId, displayName),
    loadTools(client, present, org.orgId, displayName),
    loadMoney(client, present, org.orgId, input.userId),
    loadOnboarding(client, present, org.orgId, input.userId),
    loadPacking(client, present, org.orgId, input.userId),
  ]);

  return composeMyKit({
    orgId: org.orgId,
    orgName: org.orgName,
    teamNumber: org.teamNumber,
    userId: input.userId,
    displayName,
    orgRole: org.orgRole,
    teamRole: org.teamRole,
    subteams,
    nowIso: (input.now ?? new Date()).toISOString(),
    availability: availabilityFrom(present),
    tasks,
    events,
    duties,
    scoutAssignments,
    scoutAccuracy,
    media,
    hourLogs,
    learning,
    skills,
    certifications,
    tools,
    money,
    onboarding,
    packing,
  });
}
