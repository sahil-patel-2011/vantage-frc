import type { PoolClient } from "@neondatabase/serverless";
import { sanitizeItems as sanitizeSopTemplateItems } from "../checklist-library";
import {
  allianceTeamKeys,
  applyBumperCue,
  bumperColorForTeam,
  buildDefaultItems,
  computeElapsedSeconds,
  formatScheduleLabel,
  isRunComplete,
  itemsFromSopTemplate,
  parseMatchLabel,
  sanitizeChecklistItems,
  summarizeRuns,
  type SopTemplateInput,
} from ".";
import type {
  BumperColor,
  ChecklistItem,
  MatchChecklistRun,
  MatchChecklistSummary,
  UpcomingBumperMatch,
} from "./types";

export type MatchChecklistSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MatchChecklistView =
  | {
      status: "setup_required";
      message: string;
      steps: MatchChecklistSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      activeEventKey: string | null;
      runs: MatchChecklistRun[];
      upcomingMatches: UpcomingBumperMatch[];
      summary: MatchChecklistSummary;
      computedAt: string;
    };

type RunRow = {
  id: string;
  matchLabel: string;
  eventKey: string | null;
  teamNumber: number | null;
  startedAt: string;
  completedAt: string | null;
  items: unknown;
};

function sanitizeItems(raw: unknown): ChecklistItem[] {
  return sanitizeChecklistItems(raw);
}

type ScheduleRow = {
  matchKey: string;
  eventKey: string;
  compLevel: string;
  matchNumber: number;
  predictedTime: string | null;
  actualTime: string | null;
  redAlliance: unknown;
  blueAlliance: unknown;
};

function mapRun(row: RunRow, bumperColor: BumperColor | null): MatchChecklistRun {
  const items = applyBumperCue(sanitizeItems(row.items), bumperColor);
  const allDone = isRunComplete(items);
  return {
    id: row.id,
    matchLabel: row.matchLabel,
    eventKey: row.eventKey,
    teamNumber: row.teamNumber,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    items,
    elapsedSeconds: computeElapsedSeconds(row.startedAt, row.completedAt),
    allDone,
    bumperColor,
  };
}

function bumperColorFromSchedule(
  teamNumber: number | null,
  row: ScheduleRow | undefined,
): BumperColor | null {
  if (!row) return null;
  return bumperColorForTeam(teamNumber, allianceTeamKeys(row.redAlliance), allianceTeamKeys(row.blueAlliance));
}

function findScheduleRow(
  matches: ScheduleRow[],
  input: { matchLabel: string; eventKey: string | null; fallbackEventKey: string | null },
): ScheduleRow | undefined {
  const parsed = parseMatchLabel(input.matchLabel);
  if (!parsed) return undefined;
  const eventKey = input.eventKey || input.fallbackEventKey;
  return matches.find((row) => {
    if (eventKey && row.eventKey !== eventKey) return false;
    if (parsed.matchKey && row.matchKey.toLowerCase() === parsed.matchKey) return true;
    return row.compLevel === parsed.compLevel && row.matchNumber === parsed.matchNumber;
  });
}

async function loadActiveEventKey(client: PoolClient, orgId: string): Promise<string | null> {
  try {
    const result = await client.query<{ activeEventKey: string | null }>(
      `SELECT active_event_key AS "activeEventKey"
       FROM org_active_context WHERE org_id = $1::uuid LIMIT 1`,
      [orgId],
    );
    return result.rows[0]?.activeEventKey ?? null;
  } catch {
    return null;
  }
}

async function loadSchedule(client: PoolClient, eventKeys: string[]): Promise<ScheduleRow[]> {
  const keys = [...new Set(eventKeys.filter(Boolean))];
  if (keys.length === 0) return [];
  try {
    const result = await client.query<ScheduleRow>(
      `SELECT match_key AS "matchKey", event_key AS "eventKey", comp_level AS "compLevel",
              match_number AS "matchNumber",
              predicted_time::text AS "predictedTime", actual_time::text AS "actualTime",
              red_alliance AS "redAlliance", blue_alliance AS "blueAlliance"
       FROM matches_ref
       WHERE event_key = ANY($1::text[])
       ORDER BY COALESCE(actual_time, predicted_time, event_time) NULLS LAST, match_number`,
      [keys],
    );
    return result.rows;
  } catch {
    return [];
  }
}

function upcomingBumperMatches(
  matches: ScheduleRow[],
  input: { teamNumber: number | null; eventKey: string | null },
): UpcomingBumperMatch[] {
  if (input.teamNumber == null || !input.eventKey) return [];
  const upcoming: UpcomingBumperMatch[] = [];
  for (const row of matches) {
    if (row.eventKey !== input.eventKey) continue;
    if (row.actualTime) continue;
    const color = bumperColorFromSchedule(input.teamNumber, row);
    if (!color) continue;
    upcoming.push({
      matchKey: row.matchKey,
      eventKey: row.eventKey,
      label: formatScheduleLabel(row.compLevel, row.matchNumber),
      bumperColor: color,
    });
    if (upcoming.length >= 6) break;
  }
  return upcoming;
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

export async function computeMatchChecklistView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<MatchChecklistView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to start pre-match checklists.",
      steps: [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team — checklist history stays your team's.",
          href: "/workspace",
        },
        {
          id: "command",
          label: "Open Event Day",
          detail: "Pick the active event so match labels stay aligned with the schedule.",
          href: "/competition?tab=command",
        },
      ],
      orgId: null,
    };
  }

  const runResult = await client.query<RunRow>(
    `SELECT id, match_label AS "matchLabel", event_key AS "eventKey", team_number AS "teamNumber",
            started_at::text AS "startedAt", completed_at::text AS "completedAt", items
     FROM match_checklist_runs
     WHERE org_id = $1
     ORDER BY started_at DESC
     LIMIT 100`,
    [org.orgId],
  );

  const activeEventKey = await loadActiveEventKey(client, org.orgId);
  const eventKeys = [
    activeEventKey,
    ...runResult.rows.map((row) => row.eventKey),
  ].filter((key): key is string => Boolean(key));
  const schedule = await loadSchedule(client, eventKeys);

  const runs = runResult.rows.map((row) => {
    const teamNumber = row.teamNumber ?? org.teamNumber;
    const color = bumperColorFromSchedule(
      teamNumber,
      findScheduleRow(schedule, {
        matchLabel: row.matchLabel,
        eventKey: row.eventKey,
        fallbackEventKey: activeEventKey,
      }),
    );
    return mapRun(row, color);
  });
  const summary = summarizeRuns(runs);
  const upcomingMatches = upcomingBumperMatches(schedule, {
    teamNumber: org.teamNumber,
    eventKey: activeEventKey,
  });

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    activeEventKey,
    runs,
    upcomingMatches,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

async function loadSopTemplate(
  client: PoolClient,
  orgId: string,
  templateId: string | null,
): Promise<SopTemplateInput | null> {
  try {
    if (templateId) {
      const specific = await client.query<{ id: string; name: string; items: unknown }>(
        `SELECT id, name, items
         FROM checklist_library_templates
         WHERE org_id = $1::uuid AND id = $2::uuid AND active = true
         LIMIT 1`,
        [orgId, templateId],
      );
      const row = specific.rows[0];
      if (row) {
        return { id: row.id, name: row.name, items: sanitizeSopTemplateItems(row.items) };
      }
    }
    const pit = await client.query<{ id: string; name: string; items: unknown }>(
      `SELECT id, name, items
       FROM checklist_library_templates
       WHERE org_id = $1::uuid AND active = true AND category = 'pit'
       ORDER BY created_at DESC
       LIMIT 1`,
      [orgId],
    );
    const row = pit.rows[0];
    if (!row) return null;
    return { id: row.id, name: row.name, items: sanitizeSopTemplateItems(row.items) };
  } catch {
    return null;
  }
}

async function resolveStartItems(
  client: PoolClient,
  input: {
    orgId: string;
    matchLabel: string;
    templateId?: string | null;
    sop?: SopTemplateInput | null;
  },
): Promise<ChecklistItem[]> {
  if (input.sop) return itemsFromSopTemplate(input.sop, input.matchLabel);
  const template = await loadSopTemplate(client, input.orgId, input.templateId ?? null);
  if (template) return itemsFromSopTemplate(template, input.matchLabel);
  return buildDefaultItems();
}

export async function startChecklistRun(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    matchLabel: string;
    eventKey: string | null;
    teamNumber: number | null;
    templateId?: string | null;
    sop?: SopTemplateInput | null;
  },
): Promise<void> {
  const items = await resolveStartItems(client, input);
  await client.query(
    `INSERT INTO match_checklist_runs (org_id, match_label, event_key, team_number, items, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      input.orgId,
      input.matchLabel,
      input.eventKey,
      input.teamNumber,
      JSON.stringify(items),
      input.userId,
    ],
  );
}

export async function toggleChecklistItem(
  client: PoolClient,
  input: { orgId: string; runId: string; itemKey: string },
): Promise<void> {
  const result = await client.query<RunRow>(
    `SELECT id, match_label AS "matchLabel", event_key AS "eventKey", team_number AS "teamNumber",
            started_at::text AS "startedAt", completed_at::text AS "completedAt", items
     FROM match_checklist_runs WHERE id = $1 AND org_id = $2`,
    [input.runId, input.orgId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Checklist run not found");

  const items = sanitizeItems(row.items).map((item) =>
    item.key === input.itemKey
      ? { ...item, done: !item.done, checkedAt: !item.done ? new Date().toISOString() : null }
      : item,
  );
  const completedAt = isRunComplete(items) ? (row.completedAt ?? new Date().toISOString()) : null;

  await client.query(
    `UPDATE match_checklist_runs SET items = $1::jsonb, completed_at = $2::timestamptz
     WHERE id = $3 AND org_id = $4`,
    [JSON.stringify(items), completedAt, input.runId, input.orgId],
  );
}

export async function deleteChecklistRun(
  client: PoolClient,
  input: { orgId: string; runId: string },
): Promise<void> {
  await client.query(`DELETE FROM match_checklist_runs WHERE id = $1 AND org_id = $2`, [input.runId, input.orgId]);
}
