import type { PoolClient } from "@neondatabase/serverless";
import { buildDefaultItems, computeElapsedSeconds, isRunComplete, summarizeRuns } from ".";
import type { ChecklistItem, ChecklistItemKey, MatchChecklistRun, MatchChecklistSummary } from "./types";
import { CHECKLIST_ITEM_KEYS } from ".";

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
      runs: MatchChecklistRun[];
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
  if (!Array.isArray(raw)) return buildDefaultItems();
  const byKey = new Map<string, ChecklistItem>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key : null;
    if (!key || !(CHECKLIST_ITEM_KEYS as string[]).includes(key)) continue;
    byKey.set(key, {
      key: key as ChecklistItemKey,
      label: typeof record.label === "string" ? record.label : key,
      done: Boolean(record.done),
      checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : null,
    });
  }
  // Always return items in canonical order, filling any missing keys as not-done.
  return CHECKLIST_ITEM_KEYS.map((key) => byKey.get(key) ?? buildDefaultItems().find((item) => item.key === key)!);
}

function mapRun(row: RunRow): MatchChecklistRun {
  const items = sanitizeItems(row.items);
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

export async function computeMatchChecklistView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<MatchChecklistView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to start pre-match checklists.",
      steps: [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Choose your team organization — checklist history stays org-scoped.",
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

  const runs = runResult.rows.map(mapRun);
  const summary = summarizeRuns(runs);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    runs,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function startChecklistRun(
  client: PoolClient,
  input: { orgId: string; userId: string; matchLabel: string; eventKey: string | null; teamNumber: number | null },
): Promise<void> {
  await client.query(
    `INSERT INTO match_checklist_runs (org_id, match_label, event_key, team_number, items, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      input.orgId,
      input.matchLabel,
      input.eventKey,
      input.teamNumber,
      JSON.stringify(buildDefaultItems()),
      input.userId,
    ],
  );
}

export async function toggleChecklistItem(
  client: PoolClient,
  input: { orgId: string; runId: string; itemKey: ChecklistItemKey },
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
