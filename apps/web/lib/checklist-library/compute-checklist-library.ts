import type { PoolClient } from "@neondatabase/serverless";
import { runProgress, sanitizeItems, summarizeChecklistLibrary } from ".";
import {
  instantiatePitChecklistFromSop,
  pitChecklistHref,
  pitRunItemsJson,
} from "./instantiate-pit-checklist";
import type {
  ChecklistLibraryCategory,
  ChecklistLibraryCheckedItem,
  ChecklistLibraryItem,
  ChecklistLibraryPitProjection,
  ChecklistLibraryPitRun,
  ChecklistLibraryRun,
  ChecklistLibrarySummary,
  ChecklistLibraryTemplate,
} from "./types";

export type ChecklistLibrarySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ChecklistLibraryView =
  | {
      status: "setup_required";
      message: string;
      steps: ChecklistLibrarySetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      templates: ChecklistLibraryTemplate[];
      runs: ChecklistLibraryRun[];
      /** Timed pit/match runs — read from `match_checklist_runs`, not copied. */
      pitChecklist: ChecklistLibraryPitProjection;
      summary: ChecklistLibrarySummary;
      computedAt: string;
      lastPitInstantiation?: {
        runId: string;
        href: string;
        matchLabel: string;
        itemCount: number;
        unmappedCount: number;
      };
    };

type TemplateRow = {
  id: string;
  name: string;
  category: ChecklistLibraryCategory;
  description: string | null;
  items: unknown;
  active: boolean;
  createdAt: string;
};

type RunRow = {
  id: string;
  templateId: string;
  templateName: string;
  category: ChecklistLibraryCategory;
  label: string;
  startedAt: string;
  completedAt: string | null;
  templateItems: unknown;
  checkedItems: unknown;
};

function mapTemplate(row: TemplateRow): ChecklistLibraryTemplate {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    items: sanitizeItems(row.items),
    active: row.active,
    createdAt: row.createdAt,
  };
}

function sanitizeCheckedItems(raw: unknown): ChecklistLibraryCheckedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChecklistLibraryCheckedItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const key = typeof (entry as { key?: unknown }).key === "string" ? (entry as { key: string }).key : "";
    const checkedAt =
      typeof (entry as { checkedAt?: unknown }).checkedAt === "string"
        ? (entry as { checkedAt: string }).checkedAt
        : "";
    if (!key || !checkedAt) continue;
    out.push({ key, checkedAt });
  }
  return out;
}

type PitRunRow = {
  id: string;
  matchLabel: string;
  eventKey: string | null;
  startedAt: string;
  completedAt: string | null;
  items: unknown;
};

function countStoredPitProgress(raw: unknown): { itemCount: number; checkedCount: number } {
  if (!Array.isArray(raw)) return { itemCount: 0, checkedCount: 0 };
  let itemCount = 0;
  let checkedCount = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const key = (entry as { key?: unknown }).key;
    if (typeof key !== "string" || !key) continue;
    itemCount += 1;
    if ((entry as { done?: unknown }).done === true) checkedCount += 1;
  }
  return { itemCount, checkedCount };
}

function mapPitRun(row: PitRunRow, orgId: string): ChecklistLibraryPitRun {
  const { itemCount, checkedCount } = countStoredPitProgress(row.items);
  return {
    id: row.id,
    matchLabel: row.matchLabel,
    eventKey: row.eventKey,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    itemCount,
    checkedCount,
    href: pitChecklistHref(orgId),
  };
}

async function loadPitChecklistProjection(
  client: PoolClient,
  orgId: string,
): Promise<ChecklistLibraryPitProjection> {
  const href = pitChecklistHref(orgId);
  try {
    const result = await client.query<PitRunRow>(
      `SELECT id, match_label AS "matchLabel", event_key AS "eventKey",
              started_at::text AS "startedAt", completed_at::text AS "completedAt", items
       FROM match_checklist_runs
       WHERE org_id = $1
       ORDER BY started_at DESC
       LIMIT 20`,
      [orgId],
    );
    const runs = result.rows.map((row) => mapPitRun(row, orgId));
    return {
      href,
      openRuns: runs.filter((run) => !run.completedAt).length,
      completedRuns: runs.filter((run) => Boolean(run.completedAt)).length,
      runs,
    };
  } catch {
    return { href, openRuns: 0, completedRuns: 0, runs: [] };
  }
}

function mapRun(row: RunRow): ChecklistLibraryRun {
  const items = sanitizeItems(row.templateItems);
  const checkedItems = sanitizeCheckedItems(row.checkedItems);
  const { progress, allDone } = runProgress(items, checkedItems);
  return {
    id: row.id,
    templateId: row.templateId,
    templateName: row.templateName,
    category: row.category,
    label: row.label,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    items,
    checkedItems,
    allDone,
    progress,
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

export async function computeChecklistLibraryView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<ChecklistLibraryView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to build and run reusable checklists.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [templateResult, runResult, pitChecklist] = await Promise.all([
    client.query<TemplateRow>(
      `SELECT id, name, category, description, items, active, created_at::text AS "createdAt"
       FROM checklist_library_templates
       WHERE org_id = $1
       ORDER BY active DESC, created_at DESC`,
      [org.orgId],
    ),
    client.query<RunRow>(
      `SELECT r.id, r.template_id AS "templateId", t.name AS "templateName", t.category AS category,
              r.label, r.started_at::text AS "startedAt", r.completed_at::text AS "completedAt",
              t.items AS "templateItems", r.checked_items AS "checkedItems"
       FROM checklist_library_runs r
       JOIN checklist_library_templates t ON t.id = r.template_id
       WHERE r.org_id = $1
       ORDER BY r.started_at DESC
       LIMIT 50`,
      [org.orgId],
    ),
    loadPitChecklistProjection(client, org.orgId),
  ]);

  const templates = templateResult.rows.map(mapTemplate);
  const runs = runResult.rows.map(mapRun);
  const summary = summarizeChecklistLibrary(templates, runs);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    templates,
    runs,
    pitChecklist,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createTemplate(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    category: ChecklistLibraryCategory;
    description: string | null;
    items: ChecklistLibraryItem[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO checklist_library_templates (org_id, name, category, description, items, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [input.orgId, input.name, input.category, input.description, JSON.stringify(input.items), input.userId],
  );
}

export async function setTemplateActive(
  client: PoolClient,
  input: { orgId: string; templateId: string; active: boolean },
): Promise<void> {
  await client.query(
    `UPDATE checklist_library_templates SET active = $1 WHERE id = $2 AND org_id = $3`,
    [input.active, input.templateId, input.orgId],
  );
}

export async function deleteTemplate(
  client: PoolClient,
  input: { orgId: string; templateId: string },
): Promise<void> {
  await client.query(`DELETE FROM checklist_library_templates WHERE id = $1 AND org_id = $2`, [
    input.templateId,
    input.orgId,
  ]);
}

export async function startRun(
  client: PoolClient,
  input: { orgId: string; userId: string; templateId: string; label: string },
): Promise<void> {
  await client.query(
    `INSERT INTO checklist_library_runs (org_id, template_id, label, started_by)
     SELECT $1, id, $3, $4 FROM checklist_library_templates WHERE id = $2 AND org_id = $1`,
    [input.orgId, input.templateId, input.label, input.userId],
  );
}

export async function toggleRunItem(
  client: PoolClient,
  input: { orgId: string; runId: string; itemKey: string; checked: boolean },
): Promise<void> {
  const existing = await client.query<{ checkedItems: unknown; templateItems: unknown; templateId: string }>(
    `SELECT r.checked_items AS "checkedItems", t.items AS "templateItems", r.template_id AS "templateId"
     FROM checklist_library_runs r
     JOIN checklist_library_templates t ON t.id = r.template_id
     WHERE r.id = $1 AND r.org_id = $2`,
    [input.runId, input.orgId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("Run not found");

  const checkedItems = sanitizeCheckedItems(row.checkedItems);
  const items = sanitizeItems(row.templateItems);
  const filtered = checkedItems.filter((c) => c.key !== input.itemKey);
  const next = input.checked ? [...filtered, { key: input.itemKey, checkedAt: new Date().toISOString() }] : filtered;
  const { allDone } = runProgress(items, next);

  await client.query(
    `UPDATE checklist_library_runs
     SET checked_items = $1::jsonb, completed_at = CASE WHEN $2 THEN COALESCE(completed_at, now()) ELSE NULL END
     WHERE id = $3 AND org_id = $4`,
    [JSON.stringify(next), allDone, input.runId, input.orgId],
  );
}

export async function deleteRun(client: PoolClient, input: { orgId: string; runId: string }): Promise<void> {
  await client.query(`DELETE FROM checklist_library_runs WHERE id = $1 AND org_id = $2`, [
    input.runId,
    input.orgId,
  ]);
}

/**
 * Open a timed pit/match run from a stored SOP. Writes `match_checklist_runs` only —
 * never inserts a checklist_library_runs row.
 */
export async function instantiatePitChecklist(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    templateId: string;
    matchLabel: string;
    eventKey?: string | null;
  },
): Promise<{ runId: string; href: string; itemCount: number; unmappedCount: number }> {
  const templateResult = await client.query<TemplateRow>(
    `SELECT id, name, category, description, items, active, created_at::text AS "createdAt"
     FROM checklist_library_templates
     WHERE id = $1 AND org_id = $2`,
    [input.templateId, input.orgId],
  );
  const row = templateResult.rows[0];
  if (!row) throw new Error("Template not found");
  if (!row.active) throw new Error("Activate this SOP before opening it on the pit checklist.");

  const template = mapTemplate(row);
  const instantiation = instantiatePitChecklistFromSop(template, { matchLabel: input.matchLabel });

  const org = await client.query<{ teamNumber: number | null }>(
    `SELECT team_number AS "teamNumber" FROM organizations WHERE id = $1`,
    [input.orgId],
  );
  const teamNumber = org.rows[0]?.teamNumber ?? null;

  let eventKey = input.eventKey?.trim() || null;
  if (!eventKey) {
    try {
      const context = await client.query<{ activeEventKey: string | null }>(
        `SELECT active_event_key AS "activeEventKey" FROM org_active_context WHERE org_id = $1::uuid LIMIT 1`,
        [input.orgId],
      );
      eventKey = context.rows[0]?.activeEventKey ?? null;
    } catch {
      eventKey = null;
    }
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO match_checklist_runs (org_id, match_label, event_key, team_number, items, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     RETURNING id`,
    [
      input.orgId,
      instantiation.matchLabel,
      eventKey,
      teamNumber,
      JSON.stringify(pitRunItemsJson(instantiation)),
      input.userId,
    ],
  );
  const runId = inserted.rows[0]?.id;
  if (!runId) throw new Error("Could not open a pit checklist from this SOP.");

  return {
    runId,
    href: pitChecklistHref(input.orgId),
    itemCount: instantiation.items.length,
    unmappedCount: instantiation.unmapped.length,
  };
}
