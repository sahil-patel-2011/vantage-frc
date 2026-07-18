import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { composeCadBriefDraft, detectMechanismCategory } from ".";
import type {
  BriefRecord,
  CadBriefDraft,
  MechanismCategory,
  SketchRecord,
  SketchStatus,
  SketchToBriefSetupStep,
  SketchToBriefView,
} from "./types";

export type { SketchToBriefView } from "./types";

export const SKETCH_TO_BRIEF_FEATURE = "sketch_to_brief.draft";

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function setupSteps(orgId: string | null): SketchToBriefSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — Sketch-to-Brief is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "kickoff",
      label: "Open Kickoff",
      detail: "Rule notes and design priorities stay blank until logged — never DEMO rule text.",
      href: hubHref("/build", "kickoff", orgId),
    },
    {
      id: "cad",
      label: "Open CAD",
      detail: "Mechanism geometry stays blank until connected — never DEMO models.",
      href: hubHref("/build", "cad", orgId),
    },
  ];
}

function setupRequired(
  message: string,
  steps: SketchToBriefSetupStep[],
  orgId: string | null,
  seasonYear: number,
): SketchToBriefView {
  return { status: "setup_required", message, steps, orgId, seasonYear };
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

type SketchRow = {
  id: string;
  title: string;
  notes: string;
  category: MechanismCategory;
  status: SketchStatus;
  seasonYear: number;
  createdAt: string;
};

function mapSketch(row: SketchRow): SketchRecord {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    category: row.category,
    status: row.status,
    seasonYear: row.seasonYear,
    createdAt: row.createdAt,
  };
}

type BriefRow = {
  id: string;
  sketchId: string;
  sketchTitle: string;
  title: string;
  brief: CadBriefDraft;
  generatedBy: "ai" | "local";
  createdAt: string;
};

function mapBrief(row: BriefRow): BriefRecord {
  return {
    id: row.id,
    sketchId: row.sketchId,
    sketchTitle: row.sketchTitle,
    title: row.title,
    brief: row.brief,
    generatedBy: row.generatedBy,
    createdAt: row.createdAt,
  };
}

export async function computeSketchToBriefView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<SketchToBriefView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return setupRequired(
      "Select a team workspace to turn kickoff sketches into CAD briefs — never DEMO brief metrics.",
      setupSteps(null),
      null,
      seasonYear,
    );
  }

  const [sketchResult, briefResult, seasonResult] = await Promise.all([
    client.query<SketchRow>(
      `SELECT id, title, notes, category, status, season_year AS "seasonYear", created_at::text AS "createdAt"
       FROM sketch_to_brief_sketches
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<BriefRow>(
      `SELECT b.id, b.sketch_id AS "sketchId", s.title AS "sketchTitle", b.title,
              b.brief AS "brief", b.generated_by AS "generatedBy", b.created_at::text AS "createdAt"
       FROM sketch_to_brief_briefs b
       JOIN sketch_to_brief_sketches s ON s.id = b.sketch_id
       WHERE b.org_id = $1 AND s.season_year = $2
       ORDER BY b.created_at DESC
       LIMIT 20`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM sketch_to_brief_sketches WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    sketches: sketchResult.rows.map(mapSketch),
    briefs: briefResult.rows.map(mapBrief),
    computedAt: new Date().toISOString(),
  };
}

// ---- writes ----

export async function logSketch(
  client: PoolClient,
  input: { orgId: string; userId: string; title: string; notes: string; seasonYear: number },
): Promise<void> {
  const category = detectMechanismCategory(input.notes);
  await client.query(
    `INSERT INTO sketch_to_brief_sketches (org_id, title, notes, category, season_year, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.orgId, input.title, input.notes, category, input.seasonYear, input.userId],
  );
}

export async function deleteSketch(
  client: PoolClient,
  input: { orgId: string; sketchId: string },
): Promise<void> {
  await client.query(`DELETE FROM sketch_to_brief_sketches WHERE id = $1 AND org_id = $2`, [
    input.sketchId,
    input.orgId,
  ]);
}

/** Metered generation: composes the CAD brief draft + rule-compliance flags
 * through meteredAI (usage is ledgered like every other AI-metered feature)
 * and persists the result for replay. */
export async function generateBriefFromSketch(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; sketchId: string },
): Promise<SketchToBriefView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return setupRequired(
      "Select a team workspace to turn kickoff sketches into CAD briefs — never DEMO brief metrics.",
      setupSteps(null),
      null,
      currentSeasonYear(),
    );
  }

  const sketchResult = await client.query<SketchRow>(
    `SELECT id, title, notes, category, status, season_year AS "seasonYear", created_at::text AS "createdAt"
     FROM sketch_to_brief_sketches WHERE id = $1 AND org_id = $2`,
    [input.sketchId, org.orgId],
  );
  const sketch = sketchResult.rows[0];
  if (!sketch) throw new Error("Sketch not found");

  const [answeredRuleResult, openRuleResult, priorityResult, actionResult] = await Promise.all([
    client.query<{ id: string; question: string; answer: string; ruleRef: string }>(
      `SELECT id, question, answer, rule_ref AS "ruleRef" FROM kickoff_rule_notes
       WHERE org_id = $1 AND season_year = $2 AND status = 'answered'
       ORDER BY created_at DESC LIMIT 30`,
      [org.orgId, sketch.seasonYear],
    ),
    client.query<{ id: string; question: string }>(
      `SELECT id, question FROM kickoff_rule_notes
       WHERE org_id = $1 AND season_year = $2 AND status = 'open'
       ORDER BY created_at DESC LIMIT 10`,
      [org.orgId, sketch.seasonYear],
    ),
    client.query<{ id: string; capability: string; rationale: string }>(
      `SELECT id, capability, rationale FROM design_priorities
       WHERE org_id = $1 AND season_year = $2
       ORDER BY weight DESC LIMIT 20`,
      [org.orgId, sketch.seasonYear],
    ),
    client.query<{ id: string; label: string; phase: string; points: number }>(
      `SELECT id, label, phase, points::float8 AS points FROM game_scoring_actions
       WHERE org_id = $1 AND season_year = $2
       ORDER BY sort_order LIMIT 10`,
      [org.orgId, sketch.seasonYear],
    ),
  ]);

  const requestId = `sketch-to-brief-${randomUUID()}`;
  const brief = await meteredAI<CadBriefDraft>({
    client,
    orgId: org.orgId,
    userId: input.userId,
    feature: SKETCH_TO_BRIEF_FEATURE,
    requestId,
    estimatedCostUsd: 0,
    provider: "local",
    model: "vantage-sketch-to-brief-v1",
    keySource: "local_cli",
    metadata: { sketchId: sketch.id, category: sketch.category },
    invoke: async () => {
      const value = composeCadBriefDraft({
        sketchId: sketch.id,
        notes: sketch.notes,
        category: sketch.category,
        answeredRuleNotes: answeredRuleResult.rows,
        openRuleQuestions: openRuleResult.rows,
        designPriorities: priorityResult.rows,
        scoringActions: actionResult.rows,
      });
      const text = JSON.stringify(value);
      return {
        value,
        promptTokens: Math.ceil(text.length / 4),
        completionTokens: Math.ceil(text.length / 4),
        costUsd: 0,
        model: "vantage-sketch-to-brief-v1",
        provider: "local",
      };
    },
  });

  await client.query(
    `INSERT INTO sketch_to_brief_briefs (org_id, sketch_id, title, brief, rule_flag_count, generated_by, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, 'local', $6)`,
    [org.orgId, sketch.id, sketch.title, JSON.stringify(brief), brief.ruleFlags.length, input.userId],
  );
  await client.query(`UPDATE sketch_to_brief_sketches SET status = 'brief_ready' WHERE id = $1 AND org_id = $2`, [
    sketch.id,
    org.orgId,
  ]);

  return computeSketchToBriefView(client, { userId: input.userId, requestedOrg: org.orgId, seasonYear: sketch.seasonYear });
}
