import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { loadWorkItems } from "../work-items/service";
import { workItemHref } from "../work-items/canonical";
import type { WorkItem, WorkItemSource } from "../work-items/types";
import {
  computeCoverageScore,
  countEligibleWorkBySource,
  findKnowledgeGaps,
  slugifyGapTitle,
  stubTitleFor,
  summarizeScan,
  buildStubPageBody,
} from ".";
import type {
  KnowledgeGapItem,
  KnowledgeGapPage,
  KnowledgeGapScan,
  KnowledgeGapStatus,
  KnowledgeGapSubjectKind,
  KnowledgeGapTemplateKind,
  KnowledgeGapWorkItem,
  KnowledgeGapWorkKind,
} from "./types";

export type KnowledgeGapSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type KnowledgeGapView =
  | {
      status: "setup_required";
      message: string;
      steps: KnowledgeGapSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      scan: KnowledgeGapScan | null;
      items: KnowledgeGapItem[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isWorkKind(value: unknown): value is KnowledgeGapWorkKind {
  return value === "todo" || value === "build_task" || value === "milestone";
}

/** Alias or native kind → persisted work source. Null for unknown — never invent DEMO subjects. */
export function toPersistedSubjectKind(kind: string): KnowledgeGapWorkKind | null {
  if (isWorkKind(kind)) return kind;
  if (kind === "subsystem") return "build_task";
  if (kind === "decision") return "todo";
  if (kind === "event") return "milestone";
  return null;
}

/** Persisted work source or leftover 0242 alias → client badge kind. */
export function fromPersistedSubjectKind(kind: string): KnowledgeGapSubjectKind | null {
  if (kind === "todo" || kind === "decision") return "decision";
  if (kind === "build_task" || kind === "subsystem") return "subsystem";
  if (kind === "milestone" || kind === "event") return "event";
  return null;
}

function workSourceFromStoredKind(kind: string): WorkItemSource | null {
  return toPersistedSubjectKind(kind);
}

function isStatus(value: unknown): value is KnowledgeGapStatus {
  return value === "open" || value === "drafted" || value === "dismissed";
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

type ScanRow = {
  id: string;
  seasonYear: number;
  subsystemCount: number;
  decisionCount: number;
  eventCount: number;
  pageCount: number;
  gapCount: number;
  coverageScore: string;
  summary: string;
  createdAt: string;
};

function mapScan(row: ScanRow): KnowledgeGapScan {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    subsystemCount: Number(row.subsystemCount) || 0,
    decisionCount: Number(row.decisionCount) || 0,
    eventCount: Number(row.eventCount) || 0,
    pageCount: Number(row.pageCount) || 0,
    gapCount: Number(row.gapCount) || 0,
    coverageScore: Number(row.coverageScore) || 0,
    summary: row.summary,
    createdAt: row.createdAt,
  };
}

type ItemRow = {
  id: string;
  subjectKind: string;
  subjectRef: string;
  subjectId: string | null;
  seasonYear: number;
  reason: string;
  suggestedTemplate: string;
  status: string;
  draftPageId: string | null;
  createdAt: string;
};

function itemHref(orgId: string, row: ItemRow): string | null {
  if (!row.subjectId) return null;
  const source = workSourceFromStoredKind(row.subjectKind);
  if (!source) return null;
  return workItemHref(source, orgId, row.subjectId);
}

function mapItem(row: ItemRow, orgId: string): KnowledgeGapItem {
  return {
    id: row.id,
    subjectKind: fromPersistedSubjectKind(row.subjectKind) ?? "subsystem",
    subjectRef: row.subjectRef,
    subjectId: row.subjectId,
    seasonYear: row.seasonYear,
    reason: row.reason,
    suggestedTemplate: (row.suggestedTemplate as KnowledgeGapTemplateKind) ?? "blank",
    status: isStatus(row.status) ? row.status : "open",
    draftPageId: row.draftPageId,
    createdAt: row.createdAt,
    href: itemHref(orgId, row),
  };
}

function asGapWorkItem(item: WorkItem): KnowledgeGapWorkItem {
  return {
    id: item.id,
    source: item.source,
    title: item.title,
    status: item.status,
    grouping: item.grouping,
  };
}

export async function computeKnowledgeGapView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<KnowledgeGapView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to scan work items against the wiki.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [seasonResult, scanResult] = await Promise.all([
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM knowledge_gap_scans WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    client.query<ScanRow>(
      `SELECT id, season_year AS "seasonYear", subsystem_count AS "subsystemCount",
              decision_count AS "decisionCount", event_count AS "eventCount", page_count AS "pageCount",
              gap_count AS "gapCount", coverage_score::text AS "coverageScore", summary,
              created_at AS "createdAt"
       FROM knowledge_gap_scans
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [org.orgId, seasonYear],
    ),
  ]);

  const scanRow = scanResult.rows[0] ?? null;
  const scan = scanRow ? mapScan(scanRow) : null;

  const itemsResult = scan
    ? await client.query<ItemRow>(
        `SELECT id, subject_kind AS "subjectKind", subject_ref AS "subjectRef", subject_id AS "subjectId",
                season_year AS "seasonYear", reason, suggested_template AS "suggestedTemplate", status,
                draft_page_id AS "draftPageId", created_at AS "createdAt"
         FROM knowledge_gap_items
         WHERE org_id = $1 AND scan_id = $2
         ORDER BY status ASC, created_at DESC`,
        [org.orgId, scan.id],
      )
    : null;

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    scan,
    items: itemsResult ? itemsResult.rows.map((row) => mapItem(row, org.orgId)) : [],
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

async function loadPages(client: PoolClient, orgId: string): Promise<KnowledgeGapPage[]> {
  const result = await client.query<{ id: string; title: string; body: string; tags: string[] | null; seasonYear: number | null }>(
    `SELECT id, title, body, tags, season_year AS "seasonYear" FROM knowledge_pages WHERE org_id = $1`,
    [orgId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    tags: Array.isArray(row.tags) ? row.tags : [],
    seasonYear: row.seasonYear,
  }));
}

/** Deterministic scan, wrapped in meteredAI so it flows through the standard usage ledger. */
export async function runKnowledgeGapScan(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number },
): Promise<KnowledgeGapView> {
  const [{ items: rawWorkItems }, pages] = await Promise.all([
    loadWorkItems(client, { orgId: input.orgId, seasonYear: input.seasonYear }),
    loadPages(client, input.orgId),
  ]);
  const workItems = rawWorkItems.map(asGapWorkItem);
  const counts = countEligibleWorkBySource(workItems);

  const receipt = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "knowledge_gap",
    requestId: `knowledge-gap-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      seasonYear: input.seasonYear,
      todoCount: counts.todos,
      buildTaskCount: counts.buildTasks,
      milestoneCount: counts.milestones,
      pageCount: pages.length,
      note: "Deterministic wiki vs work-items diff",
    },
    invoke: async () => {
      const gaps = findKnowledgeGaps({ workItems, pages, seasonYear: input.seasonYear });
      const coverageScore = computeCoverageScore(counts.total, gaps.length);
      const summary = summarizeScan({ totalSubjects: counts.total, gapCount: gaps.length, coverageScore });
      return {
        value: { gaps, coverageScore, summary },
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: "vantage-knowledge-gap-v1",
        provider: "vantage-local",
      };
    },
  });

  const { gaps, coverageScore, summary } = receipt;

  const scanResult = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO knowledge_gap_scans (
       org_id, season_year, subsystem_count, decision_count, event_count, page_count,
       gap_count, coverage_score, summary, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at AS "createdAt"`,
    [
      input.orgId,
      input.seasonYear,
      counts.buildTasks,
      counts.todos,
      counts.milestones,
      pages.length,
      gaps.length,
      coverageScore,
      summary,
      input.userId,
    ],
  );
  const scanId = scanResult.rows[0]!.id;

  for (const gap of gaps) {
    const subjectKind = toPersistedSubjectKind(gap.subjectKind);
    if (!subjectKind) continue;
    await client.query(
      `INSERT INTO knowledge_gap_items (
         org_id, scan_id, subject_kind, subject_ref, subject_id, season_year, reason, suggested_template
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.orgId,
        scanId,
        subjectKind,
        gap.subjectRef,
        gap.subjectId,
        gap.seasonYear,
        gap.reason,
        gap.suggestedTemplate,
      ],
    );
  }

  return computeKnowledgeGapView(client, { userId: input.userId, requestedOrg: input.orgId, seasonYear: input.seasonYear });
}

export async function draftStubPage(
  client: PoolClient,
  input: { orgId: string; userId: string; itemId: string },
): Promise<void> {
  const itemResult = await client.query<ItemRow>(
    `SELECT id, subject_kind AS "subjectKind", subject_ref AS "subjectRef", subject_id AS "subjectId",
            season_year AS "seasonYear", reason, suggested_template AS "suggestedTemplate", status,
            draft_page_id AS "draftPageId", created_at AS "createdAt"
     FROM knowledge_gap_items WHERE id = $1 AND org_id = $2`,
    [input.itemId, input.orgId],
  );
  const item = itemResult.rows[0];
  if (!item) throw new Error("Knowledge-gap item not found");
  if (item.status === "drafted" && item.draftPageId) return;

  const kind = fromPersistedSubjectKind(item.subjectKind) ?? "subsystem";
  const title = stubTitleFor(kind, item.subjectRef);
  const body = buildStubPageBody({
    subjectKind: kind,
    subjectRef: item.subjectRef,
    reason: item.reason,
    seasonYear: item.seasonYear,
  });
  const templateKind = (item.suggestedTemplate as KnowledgeGapTemplateKind) || "blank";

  let slug = slugifyGapTitle(item.subjectRef, item.id.slice(0, 8));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await client.query(`SELECT 1 FROM knowledge_pages WHERE org_id = $1 AND slug = $2`, [
      input.orgId,
      slug,
    ]);
    if (!existing.rowCount) break;
    slug = slugifyGapTitle(item.subjectRef, `${item.id.slice(0, 8)}${attempt}`);
  }

  const pageResult = await client.query<{ id: string }>(
    `INSERT INTO knowledge_pages (org_id, slug, title, body, template_kind, season_year, tags, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$8) RETURNING id`,
    [input.orgId, slug, title, body, templateKind, item.seasonYear, ["knowledge-gap-stub"], input.userId],
  );
  const pageId = pageResult.rows[0]!.id;

  await client.query(
    `UPDATE knowledge_gap_items SET status = 'drafted', draft_page_id = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [pageId, input.itemId, input.orgId],
  );
}

export async function dismissGapItem(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<void> {
  await client.query(
    `UPDATE knowledge_gap_items SET status = 'dismissed', updated_at = now() WHERE id = $1 AND org_id = $2`,
    [input.itemId, input.orgId],
  );
}
