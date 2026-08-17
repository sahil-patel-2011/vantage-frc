import type { PoolClient } from "@neondatabase/serverless";
import {
  blendPrivateEpa,
  buildPrivateEdgeView,
  cycleTimeFromObservations,
  forecastDigitalTwin,
  linkCadToScout,
  crossSeasonVsOpponent,
  type PrivateEdgeView,
  type ScoutCalibration,
  type ScoutComponentRates,
  type ScoutEvidenceCard,
  type ScoutMatchObservation,
  type TeamOperationalSignal,
} from "@vantage/prediction-strategy";

function allianceOf(match: { red?: string[]; blue?: string[] } | undefined, teamKey: string) {
  if (!match) return null;
  if (match.red?.includes(teamKey)) return "red" as const;
  if (match.blue?.includes(teamKey)) return "blue" as const;
  return null;
}

function ratesFromOps(
  op: TeamOperationalSignal | undefined,
  cycleTimeSeconds: number | null,
): ScoutComponentRates {
  return {
    autoRate: op?.autoCapability ?? null,
    teleopRate: op?.teleopCapability ?? null,
    endgameRate: op?.endgameCapability ?? null,
    sampleSize: op?.scoutSample ?? 0,
    cycleTimeSeconds,
  };
}

function emptyEdge(eventKey: string, message: string): PrivateEdgeView {
  return {
    status: "empty",
    message,
    eventKey,
    pepa: [],
    skipped: [],
    differentials: [],
    calibrations: [],
    opponentProfiles: [],
    counterPick: null,
    digitalTwin: {
      skipped: true,
      headline: message,
      remainingMatches: 0,
      highIrPacks: 0,
      activePacks: 0,
      cycleDegradePct: null,
    },
    pitAlerts: [],
    pitSignals: [],
    cadLinks: [],
    knowledge: [],
    evidence: [],
  };
}

export async function computePrivateEdgeView(
  client: PoolClient,
  input: {
    orgId: string;
    eventKey: string;
    matchKey: string;
    ourTeamKey: string;
    ourAlliance: "red" | "blue";
    red: string[];
    blue: string[];
    operations: TeamOperationalSignal[];
    publicEpaByTeam: Map<string, number | null>;
  },
): Promise<PrivateEdgeView> {
  const teamKeys = [...new Set([...input.red, ...input.blue, input.ourTeamKey])];
  const opsByTeam = new Map(input.operations.map((op) => [op.teamKey, op]));
  const opponents = (input.ourAlliance === "red" ? input.blue : input.red).filter(
    (key) => key !== input.ourTeamKey,
  );

  const observations: ScoutMatchObservation[] = [];
  const evidence: ScoutEvidenceCard[] = [];
  try {
    const scoutRows = await client.query<{
      id: string;
      teamKey: string;
      matchKey: string | null;
      payload: Record<string, unknown>;
      updatedAt: string | null;
      scoutUserId: string | null;
      source: string | null;
    }>(
      `SELECT id, team_key AS "teamKey", match_key AS "matchKey", payload,
              updated_at::text AS "updatedAt", scout_user_id::text AS "scoutUserId", source
       FROM match_scout_entries
       WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])
       ORDER BY updated_at DESC
       LIMIT 800`,
      [input.orgId, input.eventKey, teamKeys],
    );

    const matchKeys = [...new Set(scoutRows.rows.map((row) => row.matchKey).filter(Boolean))] as string[];
    const alliances = new Map<string, { red: string[]; blue: string[] }>();
    if (matchKeys.length) {
      const matches = await client.query<{
        matchKey: string;
        red: { teamKeys?: string[] } | null;
        blue: { teamKeys?: string[] } | null;
      }>(
        `SELECT match_key AS "matchKey", red_alliance AS red, blue_alliance AS blue
         FROM matches_ref WHERE match_key = ANY($1::text[])`,
        [matchKeys],
      );
      for (const row of matches.rows) {
        alliances.set(row.matchKey, {
          red: Array.isArray(row.red?.teamKeys) ? row.red!.teamKeys! : [],
          blue: Array.isArray(row.blue?.teamKeys) ? row.blue!.teamKeys! : [],
        });
      }
    }

    const mediaCounts = new Map<string, number>();
    try {
      const media = await client.query<{ entryId: string; n: number }>(
        `SELECT entry_id::text AS "entryId", count(*)::int AS n
         FROM scout_media
         WHERE org_id = $1 AND event_key = $2 AND entry_id IS NOT NULL
         GROUP BY entry_id`,
        [input.orgId, input.eventKey],
      );
      for (const row of media.rows) mediaCounts.set(row.entryId, row.n);
    } catch {
      // scout_media may be absent in older deploys
    }

    for (const row of scoutRows.rows) {
      const match = row.matchKey ? alliances.get(row.matchKey) : undefined;
      const notes = ["notes", "note", "comments", "pitNotes"]
        .map((key) => row.payload?.[key])
        .filter((value): value is string => typeof value === "string" && value.trim().length >= 3)
        .map((value) => value.trim());
      observations.push({
        id: row.id,
        teamKey: row.teamKey,
        matchKey: row.matchKey,
        alliance: allianceOf(match, row.teamKey),
        payload: row.payload ?? {},
        updatedAt: row.updatedAt,
        scoutUserId: row.scoutUserId,
        notes,
        mediaCount: mediaCounts.get(row.id) ?? 0,
      });
      if (notes.length || (mediaCounts.get(row.id) ?? 0) > 0) {
        evidence.push({
          teamKey: row.teamKey,
          entryId: row.id,
          matchKey: row.matchKey,
          note: notes[0] ?? null,
          source: row.source,
          mediaCount: mediaCounts.get(row.id) ?? 0,
          updatedAt: row.updatedAt,
        });
      }
    }
  } catch {
    return emptyEdge(input.eventKey, "Could not load org scout entries for Private Edge.");
  }

  const pepa = teamKeys.map((teamKey) => {
    const teamObs = observations.filter((row) => row.teamKey === teamKey);
    return blendPrivateEpa({
      teamKey,
      publicEpa: input.publicEpaByTeam.get(teamKey) ?? null,
      scout: ratesFromOps(opsByTeam.get(teamKey), cycleTimeFromObservations(teamObs)),
    });
  });

  let calibrations: ScoutCalibration[] = [];
  try {
    const cal = await client.query<{
      scoutUserId: string;
      fieldKey: string;
      agreementRate: number;
      nSamples: number;
    }>(
      `SELECT e.scout_user_id::text AS "scoutUserId", f.field_key AS "fieldKey",
              (count(*) FILTER (WHERE f.status = 'agree'))::float
                / NULLIF(count(*) FILTER (WHERE f.status IN ('agree', 'conflict')), 0) AS "agreementRate",
              count(*) FILTER (WHERE f.status IN ('agree', 'conflict'))::int AS "nSamples"
       FROM scout_crossval_fields f
       JOIN scout_crossval_runs r ON r.id = f.run_id
       JOIN match_scout_entries e ON e.id = r.match_scout_entry_id
       WHERE f.org_id = $1 AND r.event_key = $2
       GROUP BY e.scout_user_id, f.field_key
       HAVING count(*) FILTER (WHERE f.status IN ('agree', 'conflict')) >= 3`,
      [input.orgId, input.eventKey],
    );
    calibrations = cal.rows
      .filter((row) => row.agreementRate != null)
      .map((row) => ({
        scoutUserId: row.scoutUserId,
        fieldKey: row.fieldKey,
        agreementRate: Number(row.agreementRate),
        nSamples: row.nSamples,
      }));
    for (const row of calibrations) {
      await client.query(
        `INSERT INTO scout_field_reliability (
           org_id, event_key, field_key, scout_user_id, agreement_rate, n_samples, updated_at
         ) VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, now())
         ON CONFLICT (org_id, event_key, field_key, scout_user_id)
         DO UPDATE SET agreement_rate = EXCLUDED.agreement_rate, n_samples = EXCLUDED.n_samples, updated_at = now()`,
        [input.orgId, input.eventKey, row.fieldKey, row.scoutUserId, row.agreementRate, row.nSamples],
      );
    }
  } catch {
    calibrations = [];
  }

  let remainingMatches = 0;
  try {
    const remaining = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM matches_ref m
       WHERE m.event_key = $1
         AND m.winning_alliance IS NULL
         AND (
           COALESCE(m.red_alliance->'teamKeys', '[]'::jsonb) ? $2
           OR COALESCE(m.blue_alliance->'teamKeys', '[]'::jsonb) ? $2
         )`,
      [input.eventKey, input.ourTeamKey],
    );
    remainingMatches = remaining.rows[0]?.n ?? 0;
  } catch {
    remainingMatches = 0;
  }

  const packs: Array<{ label: string; status: string; irMohm: number | null }> = [];
  try {
    const battery = await client.query<{
      label: string;
      status: string;
      irMohm: number | null;
    }>(
      `SELECT p.label, p.status,
              (
                SELECT l.internal_resistance_mohm
                FROM battery_logs l
                WHERE l.battery_id = p.id AND l.internal_resistance_mohm IS NOT NULL
                ORDER BY l.created_at DESC
                LIMIT 1
              ) AS "irMohm"
       FROM battery_packs p
       WHERE p.org_id = $1 AND p.status IN ('active', 'quarantine')`,
      [input.orgId],
    );
    packs.push(...battery.rows);
  } catch {
    // battery tables optional
  }

  const ourObs = observations.filter((row) => row.teamKey === input.ourTeamKey);
  const digitalTwin = forecastDigitalTwin({
    remainingMatches,
    packs,
    ourCycleObservations: ourObs
      .map((row) => {
        const cycle = row.payload
          ? (["cycleTime", "cycle_time", "avgCycleTime", "secondsPerCycle"] as const)
              .map((key) => row.payload[key])
              .find((value): value is number => typeof value === "number" && Number.isFinite(value))
          : null;
        return cycle != null && row.updatedAt
          ? { cycleTimeSeconds: cycle, updatedAt: row.updatedAt }
          : null;
      })
      .filter((row): row is { cycleTimeSeconds: number; updatedAt: string } => row != null),
  });

  const fieldSamples = new Map<string, number>();
  for (const row of ourObs) {
    for (const key of Object.keys(row.payload ?? {})) {
      fieldSamples.set(key, (fieldSamples.get(key) ?? 0) + 1);
    }
  }

  let cadLinks = [] as ReturnType<typeof linkCadToScout>;
  try {
    const year = Number(input.eventKey.slice(0, 4));
    const subsystems = await client.query<{
      id: string;
      name: string;
      category: string;
    }>(
      `SELECT id::text, name, category FROM robot_subsystems
       WHERE org_id = $1 AND season_year = $2
       ORDER BY sort_order NULLS LAST, name
       LIMIT 40`,
      [input.orgId, Number.isFinite(year) ? year : new Date().getFullYear()],
    );
    cadLinks = linkCadToScout({
      subsystems: subsystems.rows,
      fieldSamples: [...fieldSamples.entries()].map(([fieldKey, sampleSize]) => ({ fieldKey, sampleSize })),
    });
    for (const link of cadLinks) {
      await client.query(
        `INSERT INTO cad_scout_links (org_id, subsystem_id, field_key)
         VALUES ($1::uuid, $2::uuid, $3)
         ON CONFLICT (org_id, subsystem_id, field_key) DO NOTHING`,
        [input.orgId, link.subsystemId, link.fieldKey],
      );
    }
  } catch {
    cadLinks = [];
  }

  let knowledge: ReturnType<typeof crossSeasonVsOpponent> = [];
  const primaryOpponent = opponents[0];
  const opponentNumber = primaryOpponent ? Number(primaryOpponent.replace(/^frc/i, "")) : NaN;
  if (Number.isFinite(opponentNumber)) {
    try {
      const [decisions, failures, pages] = await Promise.all([
        client.query<{ title: string; decision: string | null; rationale: string | null; category: string | null }>(
          `SELECT title, decision, rationale, category FROM decision_records
           WHERE org_id = $1 AND (
             title ILIKE $2 OR coalesce(decision,'') ILIKE $2 OR coalesce(rationale,'') ILIKE $2
           )
           ORDER BY updated_at DESC LIMIT 12`,
          [input.orgId, `%${opponentNumber}%`],
        ),
        client.query<{ title: string; rootCause: string | null; status: string | null; subsystemName: string | null }>(
          `SELECT title, root_cause AS "rootCause", status, subsystem_name AS "subsystemName"
           FROM fmea_failures
           WHERE org_id = $1 AND (title ILIKE $2 OR coalesce(root_cause,'') ILIKE $2)
           ORDER BY occurred_at DESC LIMIT 12`,
          [input.orgId, `%${opponentNumber}%`],
        ),
        client.query<{ title: string; excerpt: string | null }>(
          `SELECT title, left(body, 240) AS excerpt
           FROM knowledge_pages
           WHERE org_id = $1 AND (title ILIKE $2 OR body ILIKE $2)
           ORDER BY updated_at DESC LIMIT 8`,
          [input.orgId, `%${opponentNumber}%`],
        ).catch(() => ({ rows: [] as Array<{ title: string; excerpt: string | null }> })),
      ]);
      knowledge = crossSeasonVsOpponent({
        opponentTeamNumber: opponentNumber,
        decisions: decisions.rows,
        failures: failures.rows,
        pages: pages.rows,
      });
    } catch {
      knowledge = [];
    }
  }

  const opponentRates = new Map<string, ScoutComponentRates>();
  for (const opponent of opponents) {
    opponentRates.set(
      opponent,
      ratesFromOps(opsByTeam.get(opponent), cycleTimeFromObservations(observations.filter((row) => row.teamKey === opponent))),
    );
  }

  const view = buildPrivateEdgeView({
    eventKey: input.eventKey,
    ourTeamKey: input.ourTeamKey,
    opponentTeamKeys: opponents,
    pepa,
    ourRates: ratesFromOps(
      opsByTeam.get(input.ourTeamKey),
      cycleTimeFromObservations(ourObs),
    ),
    opponentRates,
    observations,
    calibrations,
    counterPickTaken: opponents[0] ?? null,
    digitalTwin,
    cadLinks,
    knowledge,
    evidence,
  });

  try {
    for (const row of view.pepa) {
      await client.query(
        `INSERT INTO private_epa_snapshots (
           org_id, event_key, team_key, public_epa, pepa, scout_component_epa, scout_sample, components, computed_at
         ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
         ON CONFLICT (org_id, event_key, team_key)
         DO UPDATE SET public_epa = EXCLUDED.public_epa, pepa = EXCLUDED.pepa,
           scout_component_epa = EXCLUDED.scout_component_epa, scout_sample = EXCLUDED.scout_sample,
           components = EXCLUDED.components, computed_at = now()`,
        [
          input.orgId,
          input.eventKey,
          row.teamKey,
          row.publicEpa,
          row.pepa,
          row.scoutComponentEpa,
          row.scoutSample,
          JSON.stringify(row.components),
        ],
      );
    }
  } catch {
    // snapshots table may not be migrated yet
  }

  try {
    for (const signal of view.pitSignals.slice(0, 40)) {
      if (!signal.entryId) continue;
      await client.query(
        `INSERT INTO scout_pit_signals (
           org_id, event_key, team_key, match_key, scout_entry_id, signal_kind, note, alliance_color
         ) VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8)
         ON CONFLICT (org_id, scout_entry_id, signal_kind) DO NOTHING`,
        [
          input.orgId,
          input.eventKey,
          signal.teamKey,
          signal.matchKey,
          signal.entryId,
          signal.signalKind,
          signal.note,
          signal.alliance,
        ],
      );
      if (signal.teamKey === input.ourTeamKey) {
        await client.query(
          `INSERT INTO org_live_alerts (
             org_id, event_key, type, severity, title, body, dedupe_key, source_refs
           ) VALUES (
             $1::uuid, $2, 'scout_pit', 'warning', $3, $4, $5,
             jsonb_build_array(jsonb_build_object('source','match_scout_entries','id',$6,'observedAt', now()::text))
           )
           ON CONFLICT (org_id, dedupe_key) DO NOTHING`,
          [
            input.orgId,
            input.eventKey,
            `Scout: ${signal.signalKind.replace(/_/g, " ")}`,
            `${signal.note}${signal.matchKey ? ` · ${signal.matchKey}` : ""}`,
            `scout-pit:${input.eventKey}:${signal.teamKey}:${signal.entryId}:${signal.signalKind}`,
            signal.entryId,
          ],
        );
      }
    }
  } catch {
    // pit signal / live alert insert is best-effort
  }

  return view;
}
