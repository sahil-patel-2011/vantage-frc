import type { PoolClient } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { sanitizeSignals, summarizeSheets } from ".";
import type { DriveTeamSignal, DriveTeamSignalSheet, DriveTeamSignalsSummary, SignalKind, SignalPriority, SignalRole } from "./types";

export type DriveTeamSignalsSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type DriveTeamSignalsView =
  | {
      status: "setup_required";
      message: string;
      steps: DriveTeamSignalsSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      sheets: DriveTeamSignalSheet[];
      summary: DriveTeamSignalsSummary;
      computedAt: string;
    };

function currentGameYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type SheetRow = {
  id: string;
  title: string;
  gameYear: number;
  eventKey: string | null;
  signals: unknown;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapSheet(row: SheetRow): DriveTeamSignalSheet {
  return {
    id: row.id,
    title: row.title,
    gameYear: row.gameYear,
    eventKey: row.eventKey,
    signals: sanitizeSignals(row.signals),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

export async function computeDriveTeamSignalsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<DriveTeamSignalsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to build a drive-team signal board.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const sheetResult = await client.query<SheetRow>(
    `SELECT id, title, game_year AS "gameYear", event_key AS "eventKey", signals, notes,
            created_at::text AS "createdAt", updated_at::text AS "updatedAt"
     FROM drive_team_signals_sheets
     WHERE org_id = $1
     ORDER BY game_year DESC, created_at DESC
     LIMIT 100`,
    [org.orgId],
  );

  const sheets = sheetResult.rows.map(mapSheet);
  const summary = summarizeSheets(sheets);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    sheets,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createSignalSheet(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    gameYear: number | null;
    eventKey: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO drive_team_signals_sheets (org_id, title, game_year, event_key, signals, notes, created_by)
     VALUES ($1,$2,$3,$4,'[]'::jsonb,$5,$6)`,
    [
      input.orgId,
      input.title,
      input.gameYear ?? currentGameYear(),
      input.eventKey,
      input.notes,
      input.userId,
    ],
  );
}

async function loadSheet(client: PoolClient, orgId: string, sheetId: string): Promise<SheetRow | null> {
  const result = await client.query<SheetRow>(
    `SELECT id, title, game_year AS "gameYear", event_key AS "eventKey", signals, notes,
            created_at::text AS "createdAt", updated_at::text AS "updatedAt"
     FROM drive_team_signals_sheets WHERE id = $1 AND org_id = $2`,
    [sheetId, orgId],
  );
  return result.rows[0] ?? null;
}

export async function addSignal(
  client: PoolClient,
  input: {
    orgId: string;
    sheetId: string;
    kind: SignalKind;
    code: string;
    meaning: string;
    calledBy: SignalRole;
    priority: SignalPriority;
  },
): Promise<void> {
  const row = await loadSheet(client, input.orgId, input.sheetId);
  if (!row) throw new Error("Signal sheet not found");

  const signal: DriveTeamSignal = {
    id: randomUUID(),
    kind: input.kind,
    code: input.code,
    meaning: input.meaning,
    calledBy: input.calledBy,
    priority: input.priority,
  };
  const signals = [...sanitizeSignals(row.signals), signal];

  await client.query(
    `UPDATE drive_team_signals_sheets SET signals = $1::jsonb, updated_at = now()
     WHERE id = $2 AND org_id = $3`,
    [JSON.stringify(signals), input.sheetId, input.orgId],
  );
}

export async function removeSignal(
  client: PoolClient,
  input: { orgId: string; sheetId: string; signalId: string },
): Promise<void> {
  const row = await loadSheet(client, input.orgId, input.sheetId);
  if (!row) throw new Error("Signal sheet not found");

  const signals = sanitizeSignals(row.signals).filter((signal) => signal.id !== input.signalId);

  await client.query(
    `UPDATE drive_team_signals_sheets SET signals = $1::jsonb, updated_at = now()
     WHERE id = $2 AND org_id = $3`,
    [JSON.stringify(signals), input.sheetId, input.orgId],
  );
}

export async function deleteSignalSheet(
  client: PoolClient,
  input: { orgId: string; sheetId: string },
): Promise<void> {
  await client.query(`DELETE FROM drive_team_signals_sheets WHERE id = $1 AND org_id = $2`, [
    input.sheetId,
    input.orgId,
  ]);
}
