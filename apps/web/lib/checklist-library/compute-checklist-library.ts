import type { PoolClient } from "@neondatabase/serverless";
import { runProgress, sanitizeItems, summarizeChecklistLibrary } from ".";
import type {
  ChecklistLibraryCategory,
  ChecklistLibraryCheckedItem,
  ChecklistLibraryItem,
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
      summary: ChecklistLibrarySummary;
      computedAt: string;
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

  const [templateResult, runResult] = await Promise.all([
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
