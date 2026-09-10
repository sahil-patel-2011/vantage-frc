import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { STANDARD_BREAKER_AMPS, WIRE_GAUGES, currentSeasonYear, diagnoseWiring } from ".";
import type {
  DiagnosticFlag,
  ExpectedCircuit,
  ObservedCircuit,
  WireGauge,
  WiringCheck,
  WiringMapDevice,
} from "./types";

export { STANDARD_BREAKER_AMPS, WIRE_GAUGES, currentSeasonYear };

export type WiringDiagnoserSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type WiringDiagnoserView =
  | {
      status: "setup_required";
      message: string;
      steps: WiringDiagnoserSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      checks: WiringCheck[];
      /** Team's stored wiring/CAN map for the active season, to prefill expected circuits. */
      wiringMap: WiringMapDevice[];
      computedAt: string;
    };

function isWireGauge(value: unknown): value is WireGauge {
  return typeof value === "string" && (WIRE_GAUGES as string[]).includes(value);
}

/** Parse an untrusted circuit array from a request body into typed ExpectedCircuit rows. */
export function parseExpectedCircuits(value: unknown): ExpectedCircuit[] {
  if (!Array.isArray(value)) return [];
  const out: ExpectedCircuit[] = [];
  for (const raw of value.slice(0, 48)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const channel = Number(row.channel);
    const deviceName = typeof row.deviceName === "string" ? row.deviceName.trim().slice(0, 120) : "";
    const wireGauge = isWireGauge(row.wireGauge) ? row.wireGauge : null;
    const breakerAmps = Number(row.breakerAmps);
    const expectedCurrentDrawAmps = Number(row.expectedCurrentDrawAmps);
    if (!Number.isFinite(channel) || channel < 0 || !deviceName || !wireGauge) continue;
    if (!Number.isFinite(breakerAmps) || breakerAmps <= 0) continue;
    out.push({
      channel: Math.round(channel),
      deviceName,
      wireGauge,
      breakerAmps: Math.round(breakerAmps * 100) / 100,
      expectedCurrentDrawAmps:
        Number.isFinite(expectedCurrentDrawAmps) && expectedCurrentDrawAmps >= 0
          ? Math.round(expectedCurrentDrawAmps * 100) / 100
          : 0,
    });
  }
  return out;
}

/** Parse an untrusted circuit array from a request body into typed ObservedCircuit rows. */
export function parseObservedCircuits(value: unknown): ObservedCircuit[] {
  if (!Array.isArray(value)) return [];
  const out: ObservedCircuit[] = [];
  for (const raw of value.slice(0, 48)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const channel = Number(row.channel);
    const deviceName = typeof row.deviceName === "string" ? row.deviceName.trim().slice(0, 120) : "";
    const wireGauge = isWireGauge(row.wireGauge) ? row.wireGauge : null;
    const breakerAmps = Number(row.breakerAmps);
    if (!Number.isFinite(channel) || channel < 0 || !deviceName || !wireGauge) continue;
    if (!Number.isFinite(breakerAmps) || breakerAmps <= 0) continue;
    out.push({
      channel: Math.round(channel),
      deviceName,
      wireGauge,
      breakerAmps: Math.round(breakerAmps * 100) / 100,
      multiWireTerminal: Boolean(row.multiWireTerminal),
    });
  }
  return out;
}

type CheckRow = {
  id: string;
  seasonYear: number;
  boardName: string;
  photoUrl: string | null;
  expectedCircuits: unknown;
  observedCircuits: unknown;
  flags: unknown;
  riskScore: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
};

function mapCheck(row: CheckRow): WiringCheck {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    boardName: row.boardName,
    photoUrl: row.photoUrl,
    expectedCircuits: parseExpectedCircuits(row.expectedCircuits),
    observedCircuits: parseObservedCircuits(row.observedCircuits),
    flags: Array.isArray(row.flags) ? (row.flags as DiagnosticFlag[]) : [],
    riskScore: Number(row.riskScore) || 0,
    summary: row.summary,
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

export async function computeWiringDiagnoserView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<WiringDiagnoserView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to diagnose wiring and power-budget faults.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [checkResult, seasonResult, wiringMapResult] = await Promise.all([
    client.query<CheckRow>(
      `SELECT id, season_year AS "seasonYear", board_name AS "boardName", photo_url AS "photoUrl",
              expected_circuits AS "expectedCircuits", observed_circuits AS "observedCircuits",
              flags, risk_score::text AS "riskScore", summary,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM wiring_diagnoser_checks
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM wiring_diagnoser_checks WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    // Ground expected circuits in the team's stored wiring/CAN map (robot_devices, mig 0095):
    // any device on the season's board that has a power-distribution port assigned.
    client.query<{ channel: number; deviceName: string; breakerAmps: number | null; subsystem: string | null }>(
      `SELECT pdh_port AS "channel", name AS "deviceName", breaker_amp AS "breakerAmps",
              NULLIF(subsystem, '') AS "subsystem"
       FROM robot_devices
       WHERE org_id = $1 AND season_year = $2 AND pdh_port IS NOT NULL
       ORDER BY pdh_port ASC, name ASC`,
      [org.orgId, seasonYear],
    ),
  ]);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  const wiringMap: WiringMapDevice[] = wiringMapResult.rows.map((row) => ({
    channel: row.channel,
    deviceName: row.deviceName,
    breakerAmps: row.breakerAmps == null ? null : Number(row.breakerAmps),
    subsystem: row.subsystem,
  }));

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    checks: checkResult.rows.map(mapCheck),
    wiringMap,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logCheck(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    boardName: string;
    photoUrl: string | null;
    expectedCircuits: ExpectedCircuit[];
    observedCircuits: ObservedCircuit[];
  },
): Promise<void> {
  const diagnosis = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "wiring_diagnoser",
    requestId: `wiring-diagnoser-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      boardName: input.boardName,
      seasonYear: input.seasonYear,
      circuitCount: input.expectedCircuits.length,
      note: "Deterministic wiring-diagram vs board-observation diff — no external model call",
    },
    invoke: async () => ({
      value: diagnoseWiring(input.expectedCircuits, input.observedCircuits),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-wiring-diagnoser-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `INSERT INTO wiring_diagnoser_checks (
       org_id, season_year, board_name, photo_url, expected_circuits, observed_circuits,
       flags, risk_score, summary, created_by
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)`,
    [
      input.orgId,
      input.seasonYear,
      input.boardName,
      input.photoUrl,
      JSON.stringify(input.expectedCircuits),
      JSON.stringify(input.observedCircuits),
      JSON.stringify(diagnosis.flags),
      diagnosis.riskScore,
      diagnosis.summary,
      input.userId,
    ],
  );
}

export async function deleteCheck(
  client: PoolClient,
  input: { orgId: string; checkId: string },
): Promise<void> {
  await client.query(`DELETE FROM wiring_diagnoser_checks WHERE id = $1 AND org_id = $2`, [
    input.checkId,
    input.orgId,
  ]);
}
