import type { PoolClient } from "@neondatabase/serverless";
import { deriveReliability } from "@vantage/intel-research";
import { nexusAttributionHref, parseNexusLive } from "@vantage/reference";
import { batteryPitFlags } from "../battery-reliability";
import { loadRepeatFailureAlerts } from "../fmea/repeat-failures";
import { loadBatteryFleet } from "../load-battery-fleet";
import { bumperCue, formatMyDayWhen } from "../my-day";
import { loadMyDayLogistics } from "../my-day-load";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { computeStrategyView, resolveTbaAccess } from "../strategy/compute-strategy";
import { emptyCommandCoverage } from "./empty-coverage";
import { buildCoverageBoard, summarizeCoverageBoard } from "./match-coverage";
import { maybeNotifyCoverageGaps } from "./notify-coverage-gaps";
import { buildScoutQueue, teamNumberFromKey, withScoutFormHrefs } from "./scout-queue";
import type {
  CommandMatch,
  CommandMyDay,
  CommandNexus,
  CommandSnapshot,
  DriveCoachBrief,
  PitFlag,
} from "./types";

function allianceKeys(alliance: unknown): string[] {
  if (!alliance || typeof alliance !== "object") return [];
  const keys = (alliance as { teamKeys?: string[] }).teamKeys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
}

function allianceScore(alliance: unknown): number | null {
  if (!alliance || typeof alliance !== "object") return null;
  const score = (alliance as { score?: number | null }).score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function pitFlagsFromPayload(input: {
  teamKey: string;
  payload: Record<string, unknown>;
  source: "pit" | "match_scout";
  submittedAt: string | null;
}): PitFlag[] {
  const flags: PitFlag[] = [];
  const p = input.payload;
  const teamNumber = teamNumberFromKey(input.teamKey);
  const when = input.submittedAt ? ` · ${new Date(input.submittedAt).toLocaleString()}` : "";
  const cite = `${input.source === "pit" ? "Pit scout" : "Match scout"}${when}`;

  if (p.jammed === true || p.intakeJammed === true || p.intake_jam === true) {
    flags.push({
      teamKey: input.teamKey,
      teamNumber,
      severity: "warning",
      title: "Intake jam noted",
      detail: String(p.notes ?? p.mechanicalNotes ?? "Scout marked an intake jam — pit ping."),
      evidence: cite,
      source: input.source,
    });
  }
  if (p.disabled === true || p.noShow === true) {
    flags.push({
      teamKey: input.teamKey,
      teamNumber,
      severity: "critical",
      title: p.noShow === true ? "No-show / DNP flagged" : "Disabled in notes",
      detail: "Reliability risk for this match — confirm with pit before relying on them.",
      evidence: cite,
      source: input.source,
    });
  }
  if (p.breakdown === true || p.broken === true) {
    flags.push({
      teamKey: input.teamKey,
      teamNumber,
      severity: "critical",
      title: "Mechanical breakdown noted",
      detail: String(p.notes ?? p.mechanicalNotes ?? p.failureNotes ?? "Scout marked a breakdown."),
      evidence: cite,
      source: input.source,
    });
  }
  const issues = [p.issues, p.concerns, p.pitNotes, p.mechanicalNotes, p.notes]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  for (const issue of issues.slice(0, 2)) {
    const lower = issue.toLowerCase();
    const severity =
      /\b(break|dead|fail|smoke|fire|dnp|disabled|can't|cannot|jam(?:med|ming)?)\b/.test(lower) ? "critical"
      : /\b(slow|hot|loose|worn|concern|risk|intermittent)\b/.test(lower) ? "warning"
      : "info";
    flags.push({
      teamKey: input.teamKey,
      teamNumber,
      severity,
      title: severity === "info" ? "Pit note" : "Pit concern",
      detail: issue.slice(0, 220),
      evidence: cite,
      source: input.source,
    });
  }
  return flags;
}

export async function loadEventDayCommand(
  client: PoolClient,
  input: { orgId: string; userId: string },
): Promise<CommandSnapshot> {
  const computedAt = new Date().toISOString();
  const membership = await client.query<{
    role: string;
    orgName: string;
    teamNumber: number | null;
    eventKey: string | null;
    eventName: string | null;
  }>(
    `SELECT m.role, o.name AS "orgName", o.team_number AS "teamNumber",
            c.active_event_key AS "eventKey", e.name AS "eventName"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN org_active_context c ON c.org_id = o.id
     LEFT JOIN events_ref e ON e.event_key = c.active_event_key
     WHERE m.org_id = $1 AND m.user_id = $2
     LIMIT 1`,
    [input.orgId, input.userId],
  );
  const row = membership.rows[0];
  if (!row) {
    return emptySnapshot({
      computedAt,
      message: "Join a team workspace to open Event Day Command.",
      setupSteps: [
        {
          id: "workspace",
          label: "Join or select a team",
          detail: "Open Home and pick your organization.",
          href: "/dashboard",
        },
      ],
    });
  }

  const teamKey = row.teamNumber ? `frc${row.teamNumber}` : null;
  const canSetEvent = ["owner", "admin"].includes(row.role);
  const tbaAccess = await resolveTbaAccess(client, input.orgId);
  const links = {
    strategy: hubHref("/competition", "strategy", input.orgId),
    scouting: hubHref("/competition", "scouting", input.orgId),
    messages: withOrgHref("/messages", input.orgId),
    intel: withOrgHref("/intel", input.orgId),
    workspace: withOrgHref("/workspace", input.orgId),
    teamData: withOrgHref("/team/data", input.orgId),
    display: withOrgHref("/display", input.orgId),
    chemistry: hubHref("/competition", "chemistry", input.orgId),
    pit: withOrgHref("/pit", input.orgId),
    batteries: withOrgHref("/batteries", input.orgId),
    myDay: hubHref("/competition", "my-day", input.orgId),
    logistics: withOrgHref("/logistics", input.orgId),
    schedule: withOrgHref("/schedule", input.orgId),
    matchChecklist: hubHref("/competition", "match-checklist", input.orgId),
  };

  const setupSteps = [
    {
      id: "event",
      label: "Select active event",
      detail: canSetEvent
        ? "Choose the competition you are at today — never DEMO events."
        : "Ask an owner/admin to set the active event.",
      href: canSetEvent ? withOrgHref("/command", input.orgId) : withOrgHref("/workspace", input.orgId),
      done: Boolean(row.eventKey),
    },
    {
      id: "tba",
      label: "Sync TBA schedule",
      detail: tbaAccess.tbaConfigured
        ? "TBA is configured — confirm sync freshness under Team → Data if matches are missing."
        : "Set TBA_AUTH_KEY or save a TBA credential under Team → Data. Never invent DEMO match times.",
      href: links.teamData,
      done: tbaAccess.tbaConfigured,
    },
    {
      id: "team",
      label: "Confirm team number",
      detail: "Your org team number powers now/next match filtering.",
      href: withOrgHref("/team", input.orgId),
      done: Boolean(teamKey),
    },
  ];

  const base: Omit<CommandSnapshot, "status" | "matches" | "scoutQueue" | "briefs" | "pitFlags" | "prediction" | "record" | "coverage"> & {
    status?: CommandSnapshot["status"];
  } = {
    computedAt,
    orgId: input.orgId,
    role: row.role,
    canSetEvent,
    orgName: row.orgName,
    teamNumber: row.teamNumber,
    teamKey,
    eventKey: row.eventKey,
    eventName: row.eventName,
    tbaConfigured: tbaAccess.tbaConfigured,
    tbaAccess,
    setupSteps,
    links,
    myDay: null,
    nexus: null,
  };

  if (!row.eventKey || !teamKey) {
    return {
      ...base,
      status: "setup_required",
      message: !row.eventKey
        ? "Select an active event to turn Event Day Command into your field-side OS."
        : "Set your organization team number so we can filter your match queue.",
      matches: [],
      scoutQueue: [],
      briefs: [],
      pitFlags: [],
      myDay: {
        bumperCue: null,
        ourAlliance: null,
        lodgingLabel: null,
        nextTravelLabel: null,
        onDutyLabel: null,
        checklistPercent: null,
        href: links.myDay,
      },
      prediction: emptyPrediction("setup_required"),
      record: emptyRecord("setup_required"),
      coverage: emptyCommandCoverage(),
      nexus: null,
    };
  }

  const eventKey = row.eventKey;

  const upcomingRows = await client.query<{
    matchKey: string;
    compLevel: string;
    matchNumber: number;
    scheduledTime: string | null;
    predictedTime: string | null;
    redAlliance: unknown;
    blueAlliance: unknown;
  }>(
    `SELECT match_key AS "matchKey", comp_level AS "compLevel", match_number AS "matchNumber",
            COALESCE(predicted_time, event_time)::text AS "scheduledTime",
            predicted_time::text AS "predictedTime",
            red_alliance AS "redAlliance", blue_alliance AS "blueAlliance"
     FROM matches_ref
     WHERE event_key = $1
       AND (
         red_alliance->'teamKeys' ? $2
         OR blue_alliance->'teamKeys' ? $2
       )
       AND COALESCE(actual_time, predicted_time, event_time) > now()
     ORDER BY COALESCE(actual_time, predicted_time, event_time)
     LIMIT 4`,
    [eventKey, teamKey],
  );

  const matches: CommandMatch[] = upcomingRows.rows.map((match, index) => {
    const redKeys = allianceKeys(match.redAlliance);
    const blueKeys = allianceKeys(match.blueAlliance);
    const onRed = redKeys.includes(teamKey);
    const onBlue = blueKeys.includes(teamKey);
    return {
      matchKey: match.matchKey,
      compLevel: match.compLevel,
      matchNumber: match.matchNumber,
      scheduledTime: match.scheduledTime,
      predictedTime: match.predictedTime,
      ourAlliance: onRed ? "red" : onBlue ? "blue" : null,
      red: { teamKeys: redKeys, score: allianceScore(match.redAlliance) },
      blue: { teamKeys: blueKeys, score: allianceScore(match.blueAlliance) },
      label: index === 0 ? "next" : index === 1 ? "after" : "after",
    };
  });
  if (matches[0]) matches[0].label = "next";

  const focusMatch = matches[0] ?? null;
  const focusTeams = focusMatch
    ? [...focusMatch.red.teamKeys, ...focusMatch.blue.teamKeys]
    : [];

  const upcomingAllianceTeams = upcomingRows.rows.flatMap((match, matchIndex) => {
    const red = allianceKeys(match.redAlliance);
    const blue = allianceKeys(match.blueAlliance);
    const onRed = red.includes(teamKey);
    const partners = onRed ? red : blue;
    const opponents = onRed ? blue : red;
    return [
      ...partners.map((key) => ({
        teamKey: key,
        matchKey: match.matchKey,
        compLevel: match.compLevel,
        matchNumber: match.matchNumber,
        scheduledTime: match.scheduledTime,
        slot: (key === teamKey ? "us" : "partner") as "us" | "partner",
        matchIndex,
      })),
      ...opponents.map((key) => ({
        teamKey: key,
        matchKey: match.matchKey,
        compLevel: match.compLevel,
        matchNumber: match.matchNumber,
        scheduledTime: match.scheduledTime,
        slot: "opponent" as const,
        matchIndex,
      })),
    ];
  });

  const teamKeysForCoverage = [
    ...new Set(upcomingAllianceTeams.map((row) => row.teamKey).filter((key) => key !== teamKey)),
  ];

  const coverageRows =
    teamKeysForCoverage.length > 0
      ? await client.query<{ teamKey: string; matchReports: string; pitReports: string }>(
          `SELECT t.team_key AS "teamKey",
                  COALESCE(m.cnt, 0)::text AS "matchReports",
                  COALESCE(p.cnt, 0)::text AS "pitReports"
           FROM unnest($3::text[]) AS t(team_key)
           LEFT JOIN (
             SELECT team_key, count(*)::int AS cnt
             FROM match_scout_entries
             WHERE org_id = $1 AND event_key = $2
             GROUP BY team_key
           ) m ON m.team_key = t.team_key
           LEFT JOIN (
             SELECT team_key, count(*)::int AS cnt
             FROM pit_scout_entries
             WHERE org_id = $1 AND event_key = $2
             GROUP BY team_key
           ) p ON p.team_key = t.team_key`,
          [input.orgId, eventKey, teamKeysForCoverage],
        )
      : { rows: [] as Array<{ teamKey: string; matchReports: string; pitReports: string }> };

  const coverage = coverageRows.rows.map((row) => ({
    teamKey: row.teamKey,
    matchReports: Number(row.matchReports),
    pitReports: Number(row.pitReports),
  }));

  const scoutQueue = withScoutFormHrefs(
    buildScoutQueue({
      ourTeamKey: teamKey,
      upcoming: upcomingAllianceTeams,
      coverage,
      orgId: input.orgId,
    }),
    input.orgId,
  );

  const counts = await client.query<{
    matchReports: string;
    pitReports: string;
    openDisagreements: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM match_scout_entries WHERE org_id = $1 AND event_key = $2) AS "matchReports",
       (SELECT count(*)::text FROM pit_scout_entries WHERE org_id = $1 AND event_key = $2) AS "pitReports",
       (SELECT count(*)::text FROM scout_disagreements WHERE org_id = $1 AND event_key = $2 AND status = 'open') AS "openDisagreements"`,
    [input.orgId, eventKey],
  );

  const pitFlags: PitFlag[] = [];
  const fleet = await loadBatteryFleet(client, input.orgId);
  for (const flag of batteryPitFlags(fleet, input.orgId)) {
    pitFlags.push({
      teamKey: teamKey ?? `org:${input.orgId}`,
      teamNumber: row.teamNumber,
      severity: flag.severity,
      title: flag.title,
      detail: flag.detail,
      evidence: flag.evidence,
      source: "battery",
    });
  }


  const repeatAlerts = await loadRepeatFailureAlerts(client, input.orgId, { limit: 6 });
  for (const alert of repeatAlerts) {
    pitFlags.push({
      teamKey: teamKey ?? `org:${input.orgId}`,
      teamNumber: row.teamNumber,
      severity: alert.level === "critical" || alert.level === "high" ? "critical" : "warning",
      title: alert.message,
      detail:
        alert.openCount > 0
          ? `${alert.openCount} still open in the FMEA log${alert.recentTitles[0] ? ` · ${alert.recentTitles[0]}` : ""}`
          : alert.recentTitles[0] ?? "Logged across events this season — confirm the root cause stuck.",
      evidence: `FMEA / failure log · ${alert.failureCount} entries · ${alert.href}`,
      source: "fmea_repeat",
    });
  }

  if (focusTeams.length) {
    const [pitEntries, matchEntries, maintenance] = await Promise.all([
      client.query<{
        teamKey: string;
        payload: Record<string, unknown>;
        submittedAt: string | null;
      }>(
        `SELECT DISTINCT ON (team_key)
                team_key AS "teamKey", payload, synced_at::text AS "submittedAt"
         FROM pit_scout_entries
         WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])
         ORDER BY team_key, synced_at DESC`,
        [input.orgId, eventKey, focusTeams],
      ),
      client.query<{
        teamKey: string;
        payload: Record<string, unknown>;
        submittedAt: string | null;
      }>(
        `SELECT team_key AS "teamKey", payload, synced_at::text AS "submittedAt"
         FROM match_scout_entries
         WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])
         ORDER BY synced_at DESC
         LIMIT 80`,
        [input.orgId, eventKey, focusTeams],
      ),
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM maintenance_items
         WHERE org_id = $1 AND completed_at IS NULL AND (due_at IS NULL OR due_at <= now() + interval '1 day')`,
        [input.orgId],
      ),
    ]);

    for (const entry of pitEntries.rows) {
      pitFlags.push(
        ...pitFlagsFromPayload({
          teamKey: entry.teamKey,
          payload: entry.payload ?? {},
          source: "pit",
          submittedAt: entry.submittedAt,
        }),
      );
    }

    const byTeam = new Map<string, Array<{ payload: Record<string, unknown>; confidence: "high" | "normal" | "low" }>>();
    for (const entry of matchEntries.rows) {
      const list = byTeam.get(entry.teamKey) ?? [];
      list.push({ payload: entry.payload ?? {}, confidence: "normal" });
      byTeam.set(entry.teamKey, list);
      if (entry.payload?.disabled || entry.payload?.breakdown || entry.payload?.noShow) {
        pitFlags.push(
          ...pitFlagsFromPayload({
            teamKey: entry.teamKey,
            payload: entry.payload ?? {},
            source: "match_scout",
            submittedAt: entry.submittedAt,
          }),
        );
      }
    }
    for (const [key, observations] of byTeam) {
      const reliability = deriveReliability(observations);
      if (reliability.score != null && reliability.score < 70 && reliability.sampleSize >= 2) {
        pitFlags.push({
          teamKey: key,
          teamNumber: teamNumberFromKey(key),
          severity: reliability.score < 50 ? "critical" : "warning",
          title: `Scout reliability ${Math.round(reliability.score)}%`,
          detail: reliability.evidence,
          evidence: `Match scout sample n=${reliability.sampleSize}`,
          source: "match_scout",
        });
      }
    }

    const due = Number(maintenance.rows[0]?.count ?? 0);
    if (due > 0) {
      pitFlags.push({
        teamKey,
        teamNumber: row.teamNumber,
        severity: "warning",
        title: `${due} maintenance item${due === 1 ? "" : "s"} due`,
        detail: "Your robot checklist has open items for today.",
        evidence: "Competition operations · maintenance_items",
        source: "maintenance",
      });
    }
  }

  // De-dupe flags by team+title
  const seenFlags = new Set<string>();
  const uniqueFlags = pitFlags.filter((flag) => {
    const key = `${flag.teamKey}:${flag.title}:${flag.severity}`;
    if (seenFlags.has(key)) return false;
    seenFlags.add(key);
    return true;
  }).slice(0, 10);

  const metrics = await client.query<{
    epaTotal: number | null;
    rank: number | null;
    wins: number | null;
    losses: number | null;
    ties: number | null;
    source: string;
    syncedAt: string | null;
  }>(
    `SELECT epa_total AS "epaTotal", rank, wins, losses, ties, source, synced_at::text AS "syncedAt"
     FROM team_event_metrics
     WHERE team_key = $1 AND event_key = $2
     ORDER BY CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END, synced_at DESC
     LIMIT 1`,
    [teamKey, eventKey],
  );

  const strategy = await computeStrategyView(client, {
    userId: input.userId,
    requestedOrg: input.orgId,
    matchKey: focusMatch?.matchKey ?? null,
  });

  let briefs: DriveCoachBrief[] = [];
  let prediction: CommandSnapshot["prediction"] = emptyPrediction("empty");

  if (strategy.status === "live") {
    const opponentKeys =
      strategy.ourAlliance === "red" ? strategy.blue : strategy.red;
    briefs = strategy.tendencies
      .filter((t) => opponentKeys.includes(t.teamKey))
      .map((t) => {
        const ops = strategy.matchup.red.concat(strategy.matchup.blue).find((b) => b.teamKey === t.teamKey);
        const capabilities: string[] = [];
        if (ops?.autoEpa != null && ops.epa != null && ops.epa > 0 && ops.autoEpa / ops.epa > 0.28) {
          capabilities.push(`Auto EPA ${Math.round(ops.autoEpa * 10) / 10}`);
        }
        if (ops?.endgameEpa != null && ops.epa != null && ops.epa > 0 && ops.endgameEpa / ops.epa > 0.25) {
          capabilities.push(`Endgame EPA ${Math.round(ops.endgameEpa * 10) / 10}`);
        }
        if (ops?.reliability != null) {
          capabilities.push(`Scout reliability ${Math.round(ops.reliability)}% (n=${ops.scoutSample})`);
        }
        if (ops?.record) capabilities.push(`Record ${ops.record}`);
        return {
          teamKey: t.teamKey,
          teamNumber: teamNumberFromKey(t.teamKey),
          labels: t.labels,
          evidence: t.evidence,
          capabilities,
        };
      });

    const pOur = strategy.ourAlliance === "red" ? strategy.prediction.pRed : strategy.prediction.pBlue;
    const pOpp = strategy.ourAlliance === "red" ? strategy.prediction.pBlue : strategy.prediction.pRed;
    prediction = {
      status: "live",
      matchKey: strategy.matchKey,
      modelVersion: strategy.prediction.modelVersion,
      pOur,
      pOpp,
      confidenceLow: strategy.prediction.confidenceLow,
      confidenceHigh: strategy.prediction.confidenceHigh,
      caveats: strategy.prediction.caveats,
      keyFactors: strategy.prediction.keyFactors.map((f) => ({
        name: f.name,
        evidence: f.evidence,
        kind: f.kind,
      })),
      matchup: strategy.matchup,
      playbook: strategy.playbook,
      tendencies: strategy.tendencies,
      fullPrediction: strategy.prediction,
    };
    links.strategy = withOrgHref(
      `/strategy?matchKey=${encodeURIComponent(strategy.matchKey)}`,
      input.orgId,
    );
  } else if (!tbaAccess.tbaConfigured) {
    prediction = emptyPrediction("setup_required");
  }

  const metric = metrics.rows[0];
  const record: CommandSnapshot["record"] = metric
    ? {
        status: "live",
        wins: metric.wins,
        losses: metric.losses,
        ties: metric.ties,
        rank: metric.rank,
        epaTotal: metric.epaTotal,
        source: metric.source,
        syncedAt: metric.syncedAt,
      }
    : emptyRecord(tbaAccess.tbaConfigured ? "empty" : "setup_required");

  const upcomingUnscouted = scoutQueue.filter((item) => !item.hasMatchScout).length;
  const c = counts.rows[0];

  const focusMatchKeys = matches.map((match) => match.matchKey);
  let liveBoard: CommandSnapshot["coverage"]["liveBoard"] = [];
  let coordinatorNudge: CommandSnapshot["coverage"]["coordinatorNudge"] = null;
  let missingRows = 0;
  let assignedWaiting = 0;
  let coveredRows = 0;
  let doubleCovered = 0;
  if (focusMatchKeys.length) {
    const [assignmentRows, entryRows] = await Promise.all([
      client.query<{ matchKey: string; teamKey: string; count: string }>(
        `SELECT match_key AS "matchKey", team_key AS "teamKey", count(*)::text AS count
         FROM scout_assignments
         WHERE org_id = $1 AND event_key = $2 AND match_key = ANY($3::text[])
         GROUP BY match_key, team_key`,
        [input.orgId, eventKey, focusMatchKeys],
      ),
      client.query<{ matchKey: string; teamKey: string; count: string }>(
        `SELECT match_key AS "matchKey", team_key AS "teamKey", count(*)::text AS count
         FROM match_scout_entries
         WHERE org_id = $1 AND event_key = $2 AND match_key = ANY($3::text[])
         GROUP BY match_key, team_key`,
        [input.orgId, eventKey, focusMatchKeys],
      ),
    ]);
    const assignmentCounts = new Map(
      assignmentRows.rows.map((row) => [`${row.matchKey}|${row.teamKey}`, Number(row.count)]),
    );
    const entryCounts = new Map(
      entryRows.rows.map((row) => [`${row.matchKey}|${row.teamKey}`, Number(row.count)]),
    );
    const board = buildCoverageBoard({
      matches: matches.map((match) => ({
        matchKey: match.matchKey,
        matchNumber: match.matchNumber,
        compLevel: match.compLevel,
        teamKeys: [...match.red.teamKeys, ...match.blue.teamKeys],
      })),
      assignmentCounts,
      entryCounts,
    });
    liveBoard = board.map((cell) => ({
      ...cell,
      teamNumber: teamNumberFromKey(cell.teamKey),
    }));
    const summary = summarizeCoverageBoard(board);
    missingRows = summary.missing;
    assignedWaiting = summary.assigned;
    coveredRows = summary.covered;
    doubleCovered = summary.doubleCovered;
    const nudge = await maybeNotifyCoverageGaps(client, {
      orgId: input.orgId,
      eventKey,
      actorUserId: input.userId,
      actorRole: row.role,
      board,
    });
    coordinatorNudge = {
      status: nudge.status,
      missingRows: nudge.missingRows,
      message: nudge.message,
    };
  }

  const profile = await client.query<{ teamRole: string | null }>(
    `SELECT team_role AS "teamRole" FROM profiles WHERE user_id = $1::uuid`,
    [input.userId],
  );
  const logistics = await loadMyDayLogistics(client, {
    orgId: input.orgId,
    userId: input.userId,
    teamRole: profile.rows[0]?.teamRole ?? null,
    eventKey,
  });
  const focus = matches[0] ?? null;
  const travelWhen = formatMyDayWhen(logistics.nextTravel?.startsAt);
  const myDay: CommandMyDay = {
    bumperCue: focus ? bumperCue(focus.ourAlliance) : null,
    ourAlliance: focus?.ourAlliance ?? null,
    lodgingLabel:
      logistics.lodging?.hotelName && logistics.lodging.roomLabel
        ? `${logistics.lodging.hotelName} · Room ${logistics.lodging.roomLabel}`
        : logistics.lodging?.hotelName ?? null,
    nextTravelLabel: logistics.nextTravel
      ? [logistics.nextTravel.title, travelWhen, logistics.nextTravel.meetingPoint || null]
          .filter(Boolean)
          .join(" · ")
      : null,
    onDutyLabel: logistics.onDuty
      ? [logistics.onDuty.mentorName || "Mentor", logistics.onDuty.phone || null].filter(Boolean).join(" · ")
      : null,
    checklistPercent: logistics.checklistPercent,
    href: links.myDay,
  };

  const nexusRow = await client.query<{ pits: unknown; live: unknown; syncedAt: string | null }>(
    `SELECT pits, live, synced_at::text AS "syncedAt"
     FROM nexus_event_snapshots WHERE event_key = $1`,
    [eventKey],
  );
  const snapshot = nexusRow.rows[0];
  const nexus: CommandNexus | null = snapshot
    ? {
        ...parseNexusLive(snapshot.live, eventKey, snapshot.syncedAt ?? computedAt),
        pitCount:
          snapshot.pits && typeof snapshot.pits === "object"
            ? Object.keys(snapshot.pits as Record<string, unknown>).length
            : 0,
        syncedAt: snapshot.syncedAt,
        attributionHref: nexusAttributionHref(),
      }
    : null;

  return {
    ...base,
    status: matches.length || metric || scoutQueue.length ? "live" : "empty",
    message:
      matches.length === 0
        ? "No upcoming matches for your team at this event yet. Confirm TBA sync and event selection."
        : undefined,
    matches,
    scoutQueue,
    briefs,
    pitFlags: uniqueFlags,
    myDay,
    nexus,
    prediction,
    record,
    coverage: emptyCommandCoverage({
      matchReports: Number(c?.matchReports ?? 0),
      pitReports: Number(c?.pitReports ?? 0),
      openDisagreements: Number(c?.openDisagreements ?? 0),
      upcomingUnscouted,
      missingRows,
      assignedWaiting,
      coveredRows,
      doubleCovered,
      liveBoard,
      coordinatorNudge,
    }),
    links,
  };
}

function emptyPrediction(status: "live" | "empty" | "setup_required"): CommandSnapshot["prediction"] {
  return {
    status,
    matchKey: null,
    modelVersion: null,
    pOur: null,
    pOpp: null,
    confidenceLow: null,
    confidenceHigh: null,
    caveats: [],
    keyFactors: [],
    matchup: null,
    playbook: null,
    tendencies: [],
    fullPrediction: null,
  };
}

function emptyRecord(status: "live" | "empty" | "setup_required"): CommandSnapshot["record"] {
  return {
    status,
    wins: null,
    losses: null,
    ties: null,
    rank: null,
    epaTotal: null,
    source: null,
    syncedAt: null,
  };
}

function emptySnapshot(input: {
  computedAt: string;
  message: string;
  setupSteps: CommandSnapshot["setupSteps"];
}): CommandSnapshot {
  return {
    status: "setup_required",
    message: input.message,
    computedAt: input.computedAt,
    orgId: null,
    role: null,
    canSetEvent: false,
    orgName: null,
    teamNumber: null,
    teamKey: null,
    eventKey: null,
    eventName: null,
    tbaConfigured: false,
    setupSteps: input.setupSteps,
    matches: [],
    scoutQueue: [],
    briefs: [],
    pitFlags: [],
    myDay: null,
    nexus: null,
    prediction: emptyPrediction("setup_required"),
    record: emptyRecord("setup_required"),
    coverage: emptyCommandCoverage(),
    links: {
      strategy: hubHref("/competition", "strategy", null),
      scouting: hubHref("/competition", "scouting", null),
      messages: "/messages",
      intel: "/intel",
      workspace: "/workspace",
      teamData: "/team/data",
      display: "/display",
      chemistry: hubHref("/competition", "chemistry", null),
      pit: "/pit",
      batteries: "/batteries",
      myDay: hubHref("/competition", "my-day", null),
      logistics: "/logistics",
      schedule: "/schedule",
      matchChecklist: hubHref("/competition", "match-checklist", null),
    },
  };
}
