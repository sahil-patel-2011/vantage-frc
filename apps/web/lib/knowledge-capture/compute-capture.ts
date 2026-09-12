// DB-facing half of capture-from-work knowledge drafts (migration 0476).
//
// Everything here runs inside the caller's withRls() transaction with parameterized SQL.
// The markdown itself is built by the pure drafters, so this module never composes prose.
//
// Approve is the ONLY path that writes knowledge_pages, and it is only reachable from an
// explicit human action in /knowledge-drafts. Nothing on this page publishes on its own.

import type { PoolClient } from "@neondatabase/serverless";
import { uniqueSlug } from "./format";
import {
  decisionEvidence,
  draftFromDecisionRecord,
  type DecisionRecordSource,
} from "./draft-decision";
import {
  draftFromIncidentReport,
  incidentEvidence,
  type IncidentReportSource,
} from "./draft-incident";
import { draftFromPitRepair, repairEvidence, type PitRepairSource } from "./draft-repair";
import {
  DRAFTABLE_INCIDENT_STATUSES,
  DRAFTABLE_REPAIR_STATUSES,
} from "./eligibility";
import type {
  CaptureCandidate,
  CaptureDraft,
  CaptureDraftRecord,
  CaptureEvidence,
  CaptureSourceKind,
} from "./types";
import { KNOWLEDGE_TEMPLATE_KINDS, type KnowledgeTemplateKind } from "../knowledge/types";

const CANDIDATE_LIMIT = 40;
const DRAFT_LIMIT = 120;

export type CaptureSetupStep = { id: string; label: string; detail: string; href: string };

export type CaptureView =
  | {
      status: "setup_required";
      message: string;
      steps: CaptureSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      candidates: CaptureCandidate[];
      drafts: CaptureDraftRecord[];
      counts: {
        candidates: number;
        openDrafts: number;
        approved: number;
        dismissed: number;
      };
      computedAt: string;
    };

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string } | null> {
  const membership = await client.query<{ orgId: string }>(
    `SELECT m.org_id AS "orgId"
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

async function loadDecisionCandidates(
  client: PoolClient,
  orgId: string,
): Promise<DecisionRecordSource[]> {
  const result = await client.query<DecisionRecordSource>(
    `SELECT d.id, d.title, d.category, d.status, d.context, d.decision, d.rationale,
            d.options, d.decided_on::text AS "decidedOn", d.deciders,
            d.season_year AS "seasonYear"
     FROM decision_records d
     LEFT JOIN knowledge_capture_drafts k
       ON k.org_id = d.org_id AND k.source_kind = 'decision_record' AND k.source_id = d.id
     WHERE d.org_id = $1::uuid AND d.status = 'accepted' AND k.id IS NULL
     ORDER BY d.updated_at DESC
     LIMIT $2`,
    [orgId, CANDIDATE_LIMIT],
  );
  return result.rows;
}

async function loadIncidentCandidates(
  client: PoolClient,
  orgId: string,
): Promise<IncidentReportSource[]> {
  const result = await client.query<IncidentReportSource>(
    `SELECT i.id, i.title, i.category, i.severity, i.status,
            i.occurred_on::text AS "occurredOn", i.location, i.description,
            i.corrective_action AS "correctiveAction", i.owner,
            i.season_year AS "seasonYear"
     FROM incident_reports i
     LEFT JOIN knowledge_capture_drafts k
       ON k.org_id = i.org_id AND k.source_kind = 'incident_report' AND k.source_id = i.id
     WHERE i.org_id = $1::uuid AND i.status = ANY($2::text[]) AND k.id IS NULL
     ORDER BY i.updated_at DESC
     LIMIT $3`,
    [orgId, [...DRAFTABLE_INCIDENT_STATUSES], CANDIDATE_LIMIT],
  );
  return result.rows;
}

async function loadRepairCandidates(client: PoolClient, orgId: string): Promise<PitRepairSource[]> {
  const result = await client.query<PitRepairSource>(
    `SELECT p.id, p.title, p.subsystem_name AS "subsystemName", p.status, p.decision,
            p.symptom_note AS "symptomNote", p.rationale, p.severity,
            p.prior_failure_count AS "priorFailureCount",
            p.minutes_until_next_match AS "minutesUntilNextMatch",
            p.prestage_recommended AS "prestageRecommended",
            p.season_year AS "seasonYear"
     FROM pit_repair_triage_reports p
     LEFT JOIN knowledge_capture_drafts k
       ON k.org_id = p.org_id AND k.source_kind = 'pit_repair_triage' AND k.source_id = p.id
     WHERE p.org_id = $1::uuid AND p.status = ANY($2::text[]) AND k.id IS NULL
     ORDER BY p.updated_at DESC
     LIMIT $3`,
    [orgId, [...DRAFTABLE_REPAIR_STATUSES], CANDIDATE_LIMIT],
  );
  return result.rows;
}

type DraftableCandidate = {
  candidate: CaptureCandidate;
  draft: CaptureDraft;
};

/**
 * Sources that can say something, paired with the page they would propose. A source too
 * thin to draft from is dropped here rather than surfaced as an empty page.
 */
async function collectDraftable(client: PoolClient, orgId: string): Promise<DraftableCandidate[]> {
  const [decisions, incidents, repairs] = await Promise.all([
    loadDecisionCandidates(client, orgId),
    loadIncidentCandidates(client, orgId),
    loadRepairCandidates(client, orgId),
  ]);

  const out: DraftableCandidate[] = [];

  for (const row of decisions) {
    const draft = draftFromDecisionRecord(row);
    if (!draft) continue;
    out.push({
      draft,
      candidate: {
        sourceKind: "decision_record",
        sourceId: row.id,
        sourceTitle: row.title,
        sourceStatus: row.status,
        sourceDate: row.decidedOn,
        seasonYear: row.seasonYear,
        evidence: decisionEvidence(row),
        proposedTitle: draft.title,
      },
    });
  }

  for (const row of incidents) {
    const draft = draftFromIncidentReport(row);
    if (!draft) continue;
    out.push({
      draft,
      candidate: {
        sourceKind: "incident_report",
        sourceId: row.id,
        sourceTitle: row.title,
        sourceStatus: row.status,
        sourceDate: row.occurredOn,
        seasonYear: row.seasonYear,
        evidence: incidentEvidence(row),
        proposedTitle: draft.title,
      },
    });
  }

  for (const row of repairs) {
    const draft = draftFromPitRepair(row);
    if (!draft) continue;
    out.push({
      draft,
      candidate: {
        sourceKind: "pit_repair_triage",
        sourceId: row.id,
        sourceTitle: row.title,
        sourceStatus: row.status,
        sourceDate: null,
        seasonYear: row.seasonYear,
        evidence: repairEvidence(row),
        proposedTitle: draft.title,
      },
    });
  }

  return out;
}

type DraftRow = {
  id: string;
  sourceKind: CaptureSourceKind;
  sourceId: string;
  proposedTitle: string;
  proposedSlug: string;
  proposedBody: string;
  templateKind: string;
  seasonYear: number | null;
  status: CaptureDraftRecord["status"];
  knowledgePageId: string | null;
  dismissedReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  sourceTitle: string | null;
  evidenceA: string | null;
  evidenceB: string | null;
};

const EVIDENCE_LABELS: Record<CaptureSourceKind, [string, string]> = {
  decision_record: ["Context", "Rationale"],
  incident_report: ["What happened", "Corrective action"],
  pit_repair_triage: ["Symptom", "Rationale"],
};

function templateKindOf(value: string): KnowledgeTemplateKind {
  return (KNOWLEDGE_TEMPLATE_KINDS as readonly string[]).includes(value)
    ? (value as KnowledgeTemplateKind)
    : "other";
}

function mapDraftRow(row: DraftRow): CaptureDraftRecord {
  const [labelA, labelB] = EVIDENCE_LABELS[row.sourceKind] ?? ["Source", "Source"];
  const evidence: CaptureEvidence[] = [];
  if (row.evidenceA?.trim()) evidence.push({ label: labelA, text: row.evidenceA.trim() });
  if (row.evidenceB?.trim()) evidence.push({ label: labelB, text: row.evidenceB.trim() });
  return {
    id: row.id,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    sourceTitle: row.sourceTitle,
    proposedTitle: row.proposedTitle,
    proposedSlug: row.proposedSlug,
    proposedBody: row.proposedBody,
    templateKind: templateKindOf(row.templateKind),
    seasonYear: row.seasonYear === null ? null : Number(row.seasonYear),
    status: row.status,
    knowledgePageId: row.knowledgePageId,
    dismissedReason: row.dismissedReason,
    evidence,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
  };
}

async function loadDrafts(client: PoolClient, orgId: string): Promise<CaptureDraftRecord[]> {
  const result = await client.query<DraftRow>(
    `SELECT k.id, k.source_kind AS "sourceKind", k.source_id AS "sourceId",
            k.proposed_title AS "proposedTitle", k.proposed_slug AS "proposedSlug",
            k.proposed_body AS "proposedBody", k.template_kind AS "templateKind",
            k.season_year AS "seasonYear", k.status,
            k.knowledge_page_id AS "knowledgePageId",
            k.dismissed_reason AS "dismissedReason",
            k.created_at::text AS "createdAt", k.reviewed_at::text AS "reviewedAt",
            COALESCE(dr.title, ir.title, pr.title) AS "sourceTitle",
            COALESCE(dr.context, ir.description, pr.symptom_note) AS "evidenceA",
            COALESCE(dr.rationale, ir.corrective_action, pr.rationale) AS "evidenceB"
     FROM knowledge_capture_drafts k
     LEFT JOIN decision_records dr
       ON k.source_kind = 'decision_record' AND dr.id = k.source_id AND dr.org_id = k.org_id
     LEFT JOIN incident_reports ir
       ON k.source_kind = 'incident_report' AND ir.id = k.source_id AND ir.org_id = k.org_id
     LEFT JOIN pit_repair_triage_reports pr
       ON k.source_kind = 'pit_repair_triage' AND pr.id = k.source_id AND pr.org_id = k.org_id
     WHERE k.org_id = $1::uuid
     ORDER BY CASE k.status WHEN 'draft' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
              k.created_at DESC
     LIMIT $2`,
    [orgId, DRAFT_LIMIT],
  );
  return result.rows.map(mapDraftRow);
}

export async function computeCaptureView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<CaptureView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to review capture-from-work drafts.",
      steps: [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose which FRC team you are working as.",
          href: "/workspace",
        },
      ],
      orgId: null,
    };
  }

  const [draftable, drafts] = await Promise.all([
    collectDraftable(client, org.orgId),
    loadDrafts(client, org.orgId),
  ]);

  return {
    status: "live",
    orgId: org.orgId,
    candidates: draftable.map((entry) => entry.candidate),
    drafts,
    counts: {
      candidates: draftable.length,
      openDrafts: drafts.filter((row) => row.status === "draft").length,
      approved: drafts.filter((row) => row.status === "approved").length,
      dismissed: drafts.filter((row) => row.status === "dismissed").length,
    },
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (each runs inside the caller's withRls transaction) ----

/**
 * Write a draft row for every eligible source that does not have one yet. Idempotent —
 * the UNIQUE(org_id, source_kind, source_id) constraint means re-running adds nothing.
 */
export async function generateCaptureDrafts(
  client: PoolClient,
  input: { orgId: string; userId: string },
): Promise<number> {
  const draftable = await collectDraftable(client, input.orgId);
  let written = 0;
  for (const entry of draftable) {
    const result = await client.query(
      `INSERT INTO knowledge_capture_drafts
         (org_id, source_kind, source_id, proposed_title, proposed_slug, proposed_body,
          template_kind, season_year, status, created_by)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, 'draft', $9::uuid)
       ON CONFLICT (org_id, source_kind, source_id) DO NOTHING`,
      [
        input.orgId,
        entry.candidate.sourceKind,
        entry.candidate.sourceId,
        entry.draft.title,
        entry.draft.slug,
        entry.draft.body,
        entry.draft.templateKind,
        entry.draft.seasonYear,
        input.userId,
      ],
    );
    written += result.rowCount ?? 0;
  }
  return written;
}

export async function editCaptureDraft(
  client: PoolClient,
  input: { orgId: string; draftId: string; title: string; body: string },
): Promise<void> {
  const result = await client.query(
    `UPDATE knowledge_capture_drafts
     SET proposed_title = $3, proposed_body = $4, updated_at = now()
     WHERE id = $2::uuid AND org_id = $1::uuid AND status = 'draft'`,
    [input.orgId, input.draftId, input.title, input.body],
  );
  if (!result.rowCount) throw new Error("Draft not found or already reviewed");
}

/**
 * The one publish path. Runs inside the request transaction: the knowledge_pages INSERT
 * and the draft's status flip either both land or neither does.
 */
export async function approveCaptureDraft(
  client: PoolClient,
  input: { orgId: string; userId: string; draftId: string },
): Promise<{ knowledgePageId: string; slug: string }> {
  const draftResult = await client.query<{
    proposedTitle: string;
    proposedSlug: string;
    proposedBody: string;
    templateKind: string;
    seasonYear: number | null;
    sourceKind: CaptureSourceKind;
  }>(
    `SELECT proposed_title AS "proposedTitle", proposed_slug AS "proposedSlug",
            proposed_body AS "proposedBody", template_kind AS "templateKind",
            season_year AS "seasonYear", source_kind AS "sourceKind"
     FROM knowledge_capture_drafts
     WHERE id = $2::uuid AND org_id = $1::uuid AND status = 'draft'
     FOR UPDATE`,
    [input.orgId, input.draftId],
  );
  const draft = draftResult.rows[0];
  if (!draft) throw new Error("Draft not found or already reviewed");

  const takenResult = await client.query<{ slug: string }>(
    `SELECT slug FROM knowledge_pages WHERE org_id = $1::uuid`,
    [input.orgId],
  );
  const slug = uniqueSlug(
    draft.proposedSlug,
    takenResult.rows.map((row) => row.slug),
  );

  const pageResult = await client.query<{ id: string }>(
    `INSERT INTO knowledge_pages
       (org_id, slug, title, body, template_kind, season_year, tags, pinned, created_by, updated_by)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::text[], false, $8::uuid, $8::uuid)
     RETURNING id`,
    [
      input.orgId,
      slug,
      draft.proposedTitle,
      draft.proposedBody,
      draft.templateKind,
      draft.seasonYear,
      ["captured", draft.sourceKind.replace(/_/g, "-")],
      input.userId,
    ],
  );
  const knowledgePageId = pageResult.rows[0]?.id;
  if (!knowledgePageId) throw new Error("Could not create the wiki page");

  await client.query(
    `UPDATE knowledge_capture_drafts
     SET status = 'approved', knowledge_page_id = $3::uuid, reviewed_by = $4::uuid,
         reviewed_at = now(), updated_at = now()
     WHERE id = $2::uuid AND org_id = $1::uuid`,
    [input.orgId, input.draftId, knowledgePageId, input.userId],
  );

  return { knowledgePageId, slug };
}

export async function dismissCaptureDraft(
  client: PoolClient,
  input: { orgId: string; userId: string; draftId: string; reason: string },
): Promise<void> {
  const result = await client.query(
    `UPDATE knowledge_capture_drafts
     SET status = 'dismissed', dismissed_reason = $3, reviewed_by = $4::uuid,
         reviewed_at = now(), updated_at = now()
     WHERE id = $2::uuid AND org_id = $1::uuid AND status = 'draft'`,
    [input.orgId, input.draftId, input.reason, input.userId],
  );
  if (!result.rowCount) throw new Error("Draft not found or already reviewed");
}
