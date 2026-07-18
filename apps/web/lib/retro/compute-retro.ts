import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { buildPostmortemNarrative, countItemsByKind, countOpenActions, groupItemsByKind } from ".";
import { retroSetupSteps, type RetroSetupStep } from "./retro-related";
import type {
  RetroActionItem,
  RetroActionStatus,
  RetroItem,
  RetroItemKind,
  RetroPostmortem,
  RetroPostmortemCounts,
  RetroSession,
  RetroSessionStatus,
} from "./types";

export type { RetroSetupStep };

export type RetroView =
  | {
      status: "setup_required";
      message: string;
      steps: RetroSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      sessions: RetroSession[];
      activeSession: RetroSession | null;
      itemsByKind: Record<RetroItemKind, RetroItem[]>;
      actionItems: RetroActionItem[];
      postmortems: RetroPostmortem[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
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

type SessionRow = {
  id: string;
  title: string;
  periodLabel: string;
  status: RetroSessionStatus;
  seasonYear: number;
  createdByName: string | null;
  createdAt: string;
  startCount: string | number;
  stopCount: string | number;
  continueCount: string | number;
  actionOpenCount: string | number;
};

function mapSession(row: SessionRow): RetroSession {
  return {
    id: row.id,
    title: row.title,
    periodLabel: row.periodLabel,
    status: row.status,
    seasonYear: row.seasonYear,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    itemCounts: {
      start: Number(row.startCount) || 0,
      stop: Number(row.stopCount) || 0,
      continue: Number(row.continueCount) || 0,
    },
    actionOpenCount: Number(row.actionOpenCount) || 0,
  };
}

export async function computeRetroView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null; sessionId?: string | null },
): Promise<RetroView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to run a retrospective.",
      steps: retroSetupSteps(null),
      orgId: null,
      seasonYear,
    };
  }

  const sessionResult = await client.query<SessionRow>(
    `SELECT s.id, s.title, s.period_label AS "periodLabel", s.status, s.season_year AS "seasonYear",
            COALESCE(NULLIF(trim(cu.name),''),cu.email) AS "createdByName", s.created_at::text AS "createdAt",
            COUNT(*) FILTER (WHERE i.kind = 'start') AS "startCount",
            COUNT(*) FILTER (WHERE i.kind = 'stop') AS "stopCount",
            COUNT(*) FILTER (WHERE i.kind = 'continue') AS "continueCount",
            COUNT(DISTINCT a.id) FILTER (WHERE a.status <> 'done') AS "actionOpenCount"
     FROM retro_sessions s
     LEFT JOIN users cu ON cu.id = s.created_by
     LEFT JOIN retro_items i ON i.session_id = s.id
     LEFT JOIN retro_action_items a ON a.session_id = s.id
     WHERE s.org_id = $1 AND s.season_year = $2
     GROUP BY s.id, cu.name, cu.email
     ORDER BY s.created_at DESC`,
    [org.orgId, seasonYear],
  );

  const sessions = sessionResult.rows.map(mapSession);
  const activeSession =
    (input.sessionId ? sessions.find((s) => s.id === input.sessionId) : null) ?? sessions[0] ?? null;

  let itemsByKind: Record<RetroItemKind, RetroItem[]> = { start: [], stop: [], continue: [] };
  let actionItems: RetroActionItem[] = [];

  if (activeSession) {
    const [itemResult, actionResult] = await Promise.all([
      client.query<{
        id: string;
        sessionId: string;
        kind: RetroItemKind;
        content: string;
        authorName: string | null;
        createdAt: string;
        voteCount: string | number;
        votedByMe: boolean;
      }>(
        `SELECT it.id, it.session_id AS "sessionId", it.kind, it.content,
                COALESCE(NULLIF(trim(au.name),''),au.email) AS "authorName", it.created_at::text AS "createdAt",
                COUNT(v.id) AS "voteCount",
                bool_or(v.user_id = $3) AS "votedByMe"
         FROM retro_items it
         LEFT JOIN users au ON au.id = it.created_by
         LEFT JOIN retro_item_votes v ON v.item_id = it.id
         WHERE it.org_id = $1 AND it.session_id = $2
         GROUP BY it.id, au.name, au.email
         ORDER BY it.created_at DESC`,
        [org.orgId, activeSession.id, input.userId],
      ),
      client.query<{
        id: string;
        sessionId: string;
        title: string;
        owner: string | null;
        status: RetroActionStatus;
        dueOn: string | null;
        createdByName: string | null;
        createdAt: string;
      }>(
        `SELECT a.id, a.session_id AS "sessionId", a.title, a.owner, a.status, a.due_on::text AS "dueOn",
                COALESCE(NULLIF(trim(cu.name),''),cu.email) AS "createdByName", a.created_at::text AS "createdAt"
         FROM retro_action_items a
         LEFT JOIN users cu ON cu.id = a.created_by
         WHERE a.org_id = $1 AND a.session_id = $2
         ORDER BY a.status ASC, a.due_on ASC NULLS LAST, a.created_at DESC`,
        [org.orgId, activeSession.id],
      ),
    ]);

    const items: RetroItem[] = itemResult.rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      kind: row.kind,
      content: row.content,
      authorName: row.authorName,
      voteCount: Number(row.voteCount) || 0,
      votedByMe: Boolean(row.votedByMe),
      createdAt: row.createdAt,
    }));
    itemsByKind = groupItemsByKind(items);
    actionItems = actionResult.rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      title: row.title,
      owner: row.owner,
      status: row.status,
      dueOn: row.dueOn,
      createdByName: row.createdByName,
      createdAt: row.createdAt,
    }));
  }

  const postmortemResult = await client.query<{
    id: string;
    seasonYear: number;
    narrative: string;
    counts: RetroPostmortemCounts;
    generatedByName: string | null;
    createdAt: string;
  }>(
    `SELECT p.id, p.season_year AS "seasonYear", p.narrative, p.counts,
            COALESCE(NULLIF(trim(gu.name),''),gu.email) AS "generatedByName", p.created_at::text AS "createdAt"
     FROM retro_postmortems p
     LEFT JOIN users gu ON gu.id = p.generated_by
     WHERE p.org_id = $1 AND p.season_year = $2
     ORDER BY p.created_at DESC`,
    [org.orgId, seasonYear],
  );
  const postmortems: RetroPostmortem[] = postmortemResult.rows.map((row) => ({
    id: row.id,
    seasonYear: row.seasonYear,
    narrative: row.narrative,
    counts: row.counts,
    generatedByName: row.generatedByName,
    createdAt: row.createdAt,
  }));

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    sessions,
    activeSession,
    itemsByKind,
    actionItems,
    postmortems,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createSession(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; title: string; periodLabel: string },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO retro_sessions (org_id, season_year, title, period_label, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [input.orgId, input.seasonYear, input.title, input.periodLabel, input.userId],
  );
  return result.rows[0]!.id;
}

export async function closeSession(client: PoolClient, input: { orgId: string; sessionId: string }): Promise<void> {
  await client.query(
    `UPDATE retro_sessions SET status = 'closed', updated_at = now() WHERE id = $1 AND org_id = $2`,
    [input.sessionId, input.orgId],
  );
}

export async function addItem(
  client: PoolClient,
  input: { orgId: string; userId: string; sessionId: string; kind: RetroItemKind; content: string },
): Promise<void> {
  await client.query(
    `INSERT INTO retro_items (org_id, session_id, kind, content, created_by) VALUES ($1,$2,$3,$4,$5)`,
    [input.orgId, input.sessionId, input.kind, input.content, input.userId],
  );
}

export async function deleteItem(client: PoolClient, input: { orgId: string; itemId: string }): Promise<void> {
  await client.query(`DELETE FROM retro_items WHERE id = $1 AND org_id = $2`, [input.itemId, input.orgId]);
}

export async function toggleVote(
  client: PoolClient,
  input: { orgId: string; userId: string; itemId: string },
): Promise<void> {
  const existing = await client.query(
    `SELECT 1 FROM retro_item_votes WHERE item_id = $1 AND user_id = $2`,
    [input.itemId, input.userId],
  );
  if (existing.rowCount) {
    await client.query(`DELETE FROM retro_item_votes WHERE item_id = $1 AND user_id = $2`, [
      input.itemId,
      input.userId,
    ]);
  } else {
    await client.query(
      `INSERT INTO retro_item_votes (org_id, item_id, user_id) VALUES ($1,$2,$3)
       ON CONFLICT (item_id, user_id) DO NOTHING`,
      [input.orgId, input.itemId, input.userId],
    );
  }
}

export async function addActionItem(
  client: PoolClient,
  input: { orgId: string; userId: string; sessionId: string; title: string; owner: string | null; dueOn: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO retro_action_items (org_id, session_id, title, owner, due_on, created_by)
     VALUES ($1,$2,$3,$4,$5::date,$6)`,
    [input.orgId, input.sessionId, input.title, input.owner, input.dueOn, input.userId],
  );
}

export async function updateActionStatus(
  client: PoolClient,
  input: { orgId: string; actionId: string; status: RetroActionStatus },
): Promise<void> {
  await client.query(
    `UPDATE retro_action_items SET status = $3, updated_at = now() WHERE id = $1 AND org_id = $2`,
    [input.actionId, input.orgId, input.status],
  );
}

export async function deleteActionItem(
  client: PoolClient,
  input: { orgId: string; actionId: string },
): Promise<void> {
  await client.query(`DELETE FROM retro_action_items WHERE id = $1 AND org_id = $2`, [
    input.actionId,
    input.orgId,
  ]);
}

/**
 * Auto-compiles the season postmortem entirely from this org's real decision/risk/incident/FMEA
 * rows and retro action items. The narrative synthesis is deterministic (grounded strictly in
 * the counted rows below, no external model call) but still runs through the standard AI-usage
 * metering path, matching the local/deterministic metering pattern used by other zero-provider-
 * cost computed briefs (see apps/web/lib/standup-digest/compute-standup-digest.ts).
 */
export async function generatePostmortem(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number },
): Promise<RetroPostmortem> {
  const [decisionsResult, risksResult, incidentsResult, fmeaResult, actionsResult] = await Promise.all([
    client.query<{ status: string; count: string }>(
      `SELECT status, count(*)::text AS count FROM decision_records
       WHERE org_id = $1 AND season_year = $2 GROUP BY status`,
      [input.orgId, input.seasonYear],
    ),
    client.query<{ status: string; count: string }>(
      `SELECT status, count(*)::text AS count FROM risk_register
       WHERE org_id = $1 AND season_year = $2 GROUP BY status`,
      [input.orgId, input.seasonYear],
    ),
    client.query<{ severity: string; count: string }>(
      `SELECT severity, count(*)::text AS count FROM incident_reports
       WHERE org_id = $1 AND season_year = $2 GROUP BY severity`,
      [input.orgId, input.seasonYear],
    ),
    client.query<{ id: string; title: string; subsystemName: string; rpn: string; status: string }>(
      `SELECT id, title, subsystem_name AS "subsystemName",
              (occurrence * severity * detection)::text AS rpn, status
       FROM fmea_failures
       WHERE org_id = $1 AND season_year = $2
       ORDER BY (occurrence * severity * detection) DESC
       LIMIT 5`,
      [input.orgId, input.seasonYear],
    ),
    client.query<{ status: string; count: string }>(
      `SELECT a.status, count(*)::text AS count
       FROM retro_action_items a
       JOIN retro_sessions s ON s.id = a.session_id
       WHERE a.org_id = $1 AND s.season_year = $2
       GROUP BY a.status`,
      [input.orgId, input.seasonYear],
    ),
  ]);

  const decisionsTotal = decisionsResult.rows.reduce((sum, r) => sum + Number(r.count), 0);
  const decisionsAccepted = decisionsResult.rows.find((r) => r.status === "accepted")?.count ?? "0";
  const decisionsRejected = decisionsResult.rows.find((r) => r.status === "rejected")?.count ?? "0";

  const risksTotal = risksResult.rows.reduce((sum, r) => sum + Number(r.count), 0);
  const risksClosed = risksResult.rows.find((r) => r.status === "closed")?.count ?? "0";
  const risksOpen = risksTotal - Number(risksClosed);

  const incidentsTotal = incidentsResult.rows.reduce((sum, r) => sum + Number(r.count), 0);
  const incidentsBySeverity = incidentsResult.rows.map((r) => ({ severity: r.severity, count: Number(r.count) }));

  const fmeaFailuresTotal = fmeaResult.rows.length;
  const fmeaTopFailures = fmeaResult.rows.map((r) => ({
    id: r.id,
    title: r.title,
    subsystemName: r.subsystemName,
    rpn: Number(r.rpn) || 0,
    status: r.status,
  }));

  const retroActionItemsTotal = actionsResult.rows.reduce((sum, r) => sum + Number(r.count), 0);
  const retroActionItemsDone = Number(actionsResult.rows.find((r) => r.status === "done")?.count ?? "0");

  const counts: RetroPostmortemCounts = {
    decisionsTotal,
    decisionsAccepted: Number(decisionsAccepted),
    decisionsRejected: Number(decisionsRejected),
    risksTotal,
    risksOpen,
    risksClosed: Number(risksClosed),
    incidentsTotal,
    incidentsBySeverity,
    fmeaFailuresTotal,
    fmeaTopFailures,
    retroActionItemsTotal,
    retroActionItemsOpen: retroActionItemsTotal - retroActionItemsDone,
  };

  const narrative = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "retro_postmortem",
    requestId: `retro-postmortem-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      seasonYear: input.seasonYear,
      note: "Deterministic season-postmortem narrative synthesis — no external model call",
    },
    invoke: async () => ({
      value: buildPostmortemNarrative({ seasonYear: input.seasonYear, counts }),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-retro-postmortem-v1",
      provider: "vantage-local",
    }),
  });

  const result = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO retro_postmortems (org_id, season_year, narrative, counts, generated_by)
     VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id, created_at::text AS "createdAt"`,
    [input.orgId, input.seasonYear, narrative, JSON.stringify(counts), input.userId],
  );

  return {
    id: result.rows[0]!.id,
    seasonYear: input.seasonYear,
    narrative,
    counts,
    generatedByName: null,
    createdAt: result.rows[0]!.createdAt,
  };
}

export { countItemsByKind, countOpenActions };
