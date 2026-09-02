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

/** A failed optional read degrades one section to empty; it never fails the page. */
async function safely<T>(run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run();
  } catch {
    return [];
  }
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
  return safely(async () => {
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
    const rows = await safely(async () => {
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
      const extra = await safely(async () => {
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

  // Member-assigned tasks (todos were folded into build_tasks in 0502). The
  // name-matched block above covers collaborative assignees; this one covers
  // the real member link so nothing assigned to *you* goes missing.
  if (present.has("build_tasks")) {
    const rows = await safely(async () => {
      const result = await client.query<{
        id: string;
        title: string;
        status: string;
        context: string | null;
        dueOn: string | null;
        priority: string | null;
      }>(
        `SELECT t.id::text AS id, t.title, t.status,
                COALESCE(${present.has("team_subteams") ? "s.name" : "NULL::text"}, t.subsystem) AS context,
                t.due_on::text AS "dueOn", t.priority
         FROM build_tasks t
         ${present.has("team_subteams") ? "LEFT JOIN team_subteams s ON s.id = t.subteam_id" : ""}
         WHERE t.org_id = $1::uuid
           AND t.assignee_user_id = $2::uuid
           AND t.status IN ('todo', 'in_progress', 'blocked')
         ORDER BY t.due_on NULLS LAST, t.created_at
         LIMIT 12`,
        [orgId, userId],
      );
      return result.rows;
    });
    for (const row of rows) {
      if (out.some((task) => task.id === row.id)) continue;
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
  return safely(async () => {
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
  return safely(async () => {
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
  return safely(async () => {
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
  const rows = await safely(async () => {
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
  return safely(async () => {
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
  return safely(async () => {
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
  const rows = await safely(async () => {
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
  return safely(async () => {
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
  return safely(async () => {
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
  return safely(async () => {
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
    const rows = await safely(async () => {
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
    const rows = await safely(async () => {
      const result = await client.query<{
        id: string;
        status: string;
        createdAt: string | null;
      }>(
        `SELECT id::text AS id, status::text AS status, created_at::text AS "createdAt"
         FROM reimbursement_requests
         WHERE org_id = $1::uuid AND requested_by = $2::uuid
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
  const rows = await safely(async () => {
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
  });
}
