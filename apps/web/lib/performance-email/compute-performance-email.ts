/**
 * Daily team performance email — PURE digest assembly.
 *
 * Everything here is deterministic and computed only from the rows the worker
 * provides (cached TBA matches, cached Statbotics/TBA event metrics, the org's
 * own scouting entries). Nothing is invented:
 * - a "do better" pointer is emitted only when it is literally computable from
 *   the score breakdowns / counts supplied;
 * - a day with no scored matches and no scouting activity produces NO digest
 *   (the caller sends nothing);
 * - ranking is reported as-is with no fabricated "movement" (we keep no rank
 *   history snapshot, so movement is never claimed).
 */

export type AllianceRef = {
  teamKeys?: string[];
  score?: number | string | null;
};

export type PerformanceMatchRow = {
  matchKey: string;
  compLevel: string;
  setNumber: number;
  matchNumber: number;
  red: AllianceRef;
  blue: AllianceRef;
  /** TBA score_breakdown jsonb — `{ red: {...}, blue: {...} }` or null. Year-dependent shape. */
  scoreBreakdown: unknown;
  /** ISO timestamp the match is/was scheduled or played at, when known. */
  scheduledAt: string | null;
};

export type EventMetricsSnapshot = {
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  source: string;
} | null;

export type ScoutingCoverageToday = {
  /** Match + pit scouting entries the org created today. */
  entries: number;
  /** Distinct scored matches at the event that got at least one org entry today. */
  matchesScouted: number;
  /** Scored matches played at the event today (all teams, not just ours). */
  matchesPlayedAtEvent: number;
  /** Distinct members who scouted today. */
  scouts: number;
};

export type PerformanceEmailInput = {
  orgName: string;
  teamNumber: number;
  /** UTC day, YYYY-MM-DD. */
  day: string;
  eventKey: string | null;
  eventName: string | null;
  /** Scored matches involving the team today (chronological). */
  matchesToday: PerformanceMatchRow[];
  /** Unscored matches involving the team scheduled for the next day (chronological). */
  upcomingMatches: PerformanceMatchRow[];
  metrics: EventMetricsSnapshot;
  scouting: ScoutingCoverageToday | null;
};

export type MatchResultLine = {
  matchKey: string;
  label: string;
  result: "W" | "L" | "T";
  us: number;
  opp: number;
  margin: number;
  /** Phase points for our alliance / opponents when the breakdown carries them. */
  phases: {
    autoUs: number | null;
    autoOpp: number | null;
    endgameUs: number | null;
    endgameOpp: number | null;
    /** Foul points AWARDED to the opponents (i.e. our penalties), when present. */
    foulsGivenToOpp: number | null;
  };
};

export type PerformanceDigest = {
  orgName: string;
  teamNumber: number;
  day: string;
  eventKey: string | null;
  eventName: string | null;
  subject: string;
  headline: string;
  record: { wins: number; losses: number; ties: number };
  results: MatchResultLine[];
  rankLine: string | null;
  scoutingLine: string | null;
  pointers: string[];
  scheduleLines: string[];
};

const MAX_POINTERS = 3;

function toScore(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  // TBA reports -1 for unplayed matches.
  return n < 0 ? null : n;
}

export function matchLabel(row: Pick<PerformanceMatchRow, "compLevel" | "setNumber" | "matchNumber">): string {
  const level = row.compLevel.toLowerCase();
  if (level === "qm") return `Qual ${row.matchNumber}`;
  if (level === "qf") return `Quarterfinal ${row.setNumber}-${row.matchNumber}`;
  if (level === "sf") return `Semifinal ${row.setNumber}-${row.matchNumber}`;
  if (level === "f") return `Final ${row.matchNumber}`;
  if (level === "ef") return `Eighthfinal ${row.setNumber}-${row.matchNumber}`;
  return `${row.compLevel.toUpperCase()} ${row.setNumber}-${row.matchNumber}`;
}

function breakdownSide(breakdown: unknown, side: "red" | "blue"): Record<string, unknown> | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const value = (breakdown as Record<string, unknown>)[side];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numericKey(obj: Record<string, unknown>, key: string): number | null {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Sum of `endGame*Points` / `endgame*Points` keys, null when none exist. */
function endgamePoints(obj: Record<string, unknown>): number | null {
  let total: number | null = null;
  for (const [key, value] of Object.entries(obj)) {
    if (!/^end[_ ]?game.*points$/i.test(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    total = (total ?? 0) + value;
  }
  return total;
}

/** Resolve one played match into a result line, or null when it is not honestly scoreable. */
export function toMatchResultLine(row: PerformanceMatchRow, teamKey: string): MatchResultLine | null {
  const redKeys = row.red.teamKeys ?? [];
  const blueKeys = row.blue.teamKeys ?? [];
  const onRed = redKeys.includes(teamKey);
  const onBlue = blueKeys.includes(teamKey);
  if (onRed === onBlue) return null; // not in this match (or corrupt data)

  const redScore = toScore(row.red.score);
  const blueScore = toScore(row.blue.score);
  if (redScore === null || blueScore === null) return null;

  const us = onRed ? redScore : blueScore;
  const opp = onRed ? blueScore : redScore;
  const usSide = breakdownSide(row.scoreBreakdown, onRed ? "red" : "blue");
  const oppSide = breakdownSide(row.scoreBreakdown, onRed ? "blue" : "red");

  return {
    matchKey: row.matchKey,
    label: matchLabel(row),
    result: us === opp ? "T" : us > opp ? "W" : "L",
    us,
    opp,
    margin: us - opp,
    phases: {
      autoUs: usSide ? numericKey(usSide, "autoPoints") : null,
      autoOpp: oppSide ? numericKey(oppSide, "autoPoints") : null,
      endgameUs: usSide ? endgamePoints(usSide) : null,
      endgameOpp: oppSide ? endgamePoints(oppSide) : null,
      // TBA convention: an alliance's foulPoints are points it RECEIVED from
      // the other alliance's penalties — so our penalties show up on `oppSide`.
      foulsGivenToOpp: oppSide ? numericKey(oppSide, "foulPoints") : null,
    },
  };
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Up to three "do better" pointers, each derived from a literal computation
 * over today's data. Order = strongest evidence first.
 */
export function derivePointers(
  results: MatchResultLine[],
  scouting: ScoutingCoverageToday | null,
): string[] {
  const pointers: string[] = [];
  const losses = results.filter((r) => r.result === "L");

  // 1) Losses decided by endgame: endgame deficit >= final margin, breakdown present.
  const endgameDecided = losses.filter(
    (r) =>
      r.phases.endgameUs !== null &&
      r.phases.endgameOpp !== null &&
      r.phases.endgameOpp - r.phases.endgameUs >= Math.abs(r.margin) &&
      r.phases.endgameOpp - r.phases.endgameUs > 0,
  );
  if (endgameDecided.length >= 2) {
    const avgDeficit = average(
      endgameDecided.map((r) => (r.phases.endgameOpp ?? 0) - (r.phases.endgameUs ?? 0)),
    );
    pointers.push(
      `Your last ${endgameDecided.length} losses were decided by endgame points — opponents out-scored you there by ${formatPoints(avgDeficit)} points on average. Lock in the endgame routine before tomorrow.`,
    );
  } else if (endgameDecided.length === 1 && endgameDecided[0]) {
    const r = endgameDecided[0];
    pointers.push(
      `${r.label} came down to endgame: opponents out-scored you there by ${formatPoints((r.phases.endgameOpp ?? 0) - (r.phases.endgameUs ?? 0))} points against a ${Math.abs(r.margin)}-point final margin.`,
    );
  }

  // 2) Auto deficit in at least 2 matches and at least half of today's matches.
  const autoComparable = results.filter(
    (r) => r.phases.autoUs !== null && r.phases.autoOpp !== null,
  );
  const autoBehind = autoComparable.filter(
    (r) => (r.phases.autoOpp ?? 0) > (r.phases.autoUs ?? 0),
  );
  if (autoBehind.length >= 2 && autoBehind.length * 2 >= autoComparable.length) {
    const avgGap = average(autoBehind.map((r) => (r.phases.autoOpp ?? 0) - (r.phases.autoUs ?? 0)));
    pointers.push(
      `Auto trailed opponents in ${autoBehind.length} of ${autoComparable.length} matches today (average gap ${formatPoints(avgGap)} points). A more consistent auto is the clearest point swing available.`,
    );
  }

  // 3) A loss where our penalties covered the margin (opponents' foulPoints >= margin).
  const penaltyLoss = losses.find(
    (r) => r.phases.foulsGivenToOpp !== null && (r.phases.foulsGivenToOpp ?? 0) >= Math.abs(r.margin) && (r.phases.foulsGivenToOpp ?? 0) > 0,
  );
  if (penaltyLoss) {
    pointers.push(
      `Penalties decided ${penaltyLoss.label}: opponents gained ${formatPoints(penaltyLoss.phases.foulsGivenToOpp ?? 0)} foul points and the final margin was ${Math.abs(penaltyLoss.margin)}. Review what drew the fouls.`,
    );
  }

  // 4) Close losses (no breakdown needed).
  const closeLosses = losses.filter((r) => Math.abs(r.margin) <= 3);
  const firstClose = closeLosses[0];
  if (firstClose) {
    pointers.push(
      closeLosses.length === 1
        ? `One loss (${firstClose.label}) was within 3 points — a single extra cycle flips it.`
        : `${closeLosses.length} losses were within 3 points each — small, repeatable gains flip these.`,
    );
  }

  // 5) Scouting coverage gap at the event.
  if (
    scouting &&
    scouting.matchesPlayedAtEvent > 0 &&
    scouting.matchesScouted < scouting.matchesPlayedAtEvent
  ) {
    pointers.push(
      `Scouting covered ${scouting.matchesScouted} of ${scouting.matchesPlayedAtEvent} matches played today — assign scouts so every match is covered tomorrow.`,
    );
  }

  return pointers.slice(0, MAX_POINTERS);
}

/**
 * Assemble the digest, or return null when the day has no real data —
 * no scored matches involving the team AND no scouting activity. Null means
 * the caller must send nothing (the honesty rule applied to email).
 */
export function computePerformanceDigest(input: PerformanceEmailInput): PerformanceDigest | null {
  const teamKey = `frc${input.teamNumber}`;
  const results = input.matchesToday
    .map((row) => toMatchResultLine(row, teamKey))
    .filter((line): line is MatchResultLine => line !== null);

  const scoutingActive = Boolean(input.scouting && input.scouting.entries > 0);
  if (results.length === 0 && !scoutingActive) return null;

  const record = {
    wins: results.filter((r) => r.result === "W").length,
    losses: results.filter((r) => r.result === "L").length,
    ties: results.filter((r) => r.result === "T").length,
  };

  const eventLabel = input.eventName ?? input.eventKey;
  const recordText = `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;

  let subject: string;
  let headline: string;
  if (results.length > 0) {
    subject = `Team ${input.teamNumber} today: ${recordText}${eventLabel ? ` at ${eventLabel}` : ""}`;
    headline = `${input.orgName} went ${recordText} in ${results.length} scored ${results.length === 1 ? "match" : "matches"} today${eventLabel ? ` at ${eventLabel}` : ""}.`;
  } else {
    subject = `Team ${input.teamNumber} scouting recap — ${input.day}`;
    headline = `No scored matches for ${input.orgName} today, but the team logged ${input.scouting?.entries ?? 0} scouting ${input.scouting?.entries === 1 ? "entry" : "entries"}.`;
  }

  const metrics = input.metrics;
  let rankLine: string | null = null;
  if (metrics && metrics.rank !== null) {
    const eventRecord =
      metrics.wins !== null && metrics.losses !== null
        ? ` (event record ${metrics.wins}-${metrics.losses}${metrics.ties ? `-${metrics.ties}` : ""})`
        : "";
    rankLine = `Current event rank: ${metrics.rank}${eventRecord} — source: ${metrics.source} cache.`;
  }

  let scoutingLine: string | null = null;
  if (input.scouting && input.scouting.entries > 0) {
    scoutingLine = `Scouting today: ${input.scouting.entries} ${input.scouting.entries === 1 ? "entry" : "entries"} from ${input.scouting.scouts} ${input.scouting.scouts === 1 ? "scout" : "scouts"}${
      input.scouting.matchesPlayedAtEvent > 0
        ? `, covering ${input.scouting.matchesScouted} of ${input.scouting.matchesPlayedAtEvent} matches played`
        : ""
    }.`;
  }

  const scheduleLines = input.upcomingMatches.map((row) => {
    const line = toUpcomingLine(row, teamKey);
    return line;
  });

  return {
    orgName: input.orgName,
    teamNumber: input.teamNumber,
    day: input.day,
    eventKey: input.eventKey,
    eventName: input.eventName,
    subject,
    headline,
    record,
    results,
    rankLine,
    scoutingLine,
    pointers: derivePointers(results, input.scouting),
    scheduleLines,
  };
}

function toUpcomingLine(row: PerformanceMatchRow, teamKey: string): string {
  const onRed = (row.red.teamKeys ?? []).includes(teamKey);
  const partners = (onRed ? row.red.teamKeys : row.blue.teamKeys ?? [])
    ?.filter((key) => key !== teamKey)
    .map((key) => key.replace(/^frc/, ""))
    .join(", ");
  const opponents = (onRed ? row.blue.teamKeys : row.red.teamKeys ?? [])
    ?.map((key) => key.replace(/^frc/, ""))
    .join(", ");
  const when = row.scheduledAt ? ` — ${row.scheduledAt.slice(11, 16)} UTC` : "";
  return `${matchLabel(row)}${when}: with ${partners || "TBD"} vs ${opponents || "TBD"}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Plain-text body. `aiParagraph` (already grounded + reviewed) slots in verbatim when present. */
export function renderPerformanceEmailText(digest: PerformanceDigest, aiParagraph?: string | null): string {
  const lines: string[] = [digest.headline, ""];

  if (digest.results.length > 0) {
    lines.push("Today's matches:");
    for (const r of digest.results) {
      lines.push(`  ${r.result}  ${r.label}: ${r.us}-${r.opp}`);
    }
    lines.push("");
  }
  if (digest.rankLine) {
    lines.push(digest.rankLine, "");
  }
  if (digest.scoutingLine) {
    lines.push(digest.scoutingLine, "");
  }
  if (aiParagraph?.trim()) {
    lines.push(aiParagraph.trim(), "");
  }
  if (digest.pointers.length > 0) {
    lines.push("Do better tomorrow:");
    for (const pointer of digest.pointers) {
      lines.push(`  - ${pointer}`);
    }
    lines.push("");
  }
  if (digest.scheduleLines.length > 0) {
    lines.push("Tomorrow's schedule:");
    for (const line of digest.scheduleLines) {
      lines.push(`  - ${line}`);
    }
    lines.push("");
  }
  lines.push(`— Vantage daily performance digest for ${digest.orgName} (${digest.day})`);
  return lines.join("\n");
}

/** Simple HTML body mirroring the text version — no external assets, inline styles only. */
export function renderPerformanceEmailHtml(digest: PerformanceDigest, aiParagraph?: string | null): string {
  const parts: string[] = [
    `<h2 style="margin:0 0 8px">${escapeHtml(digest.headline)}</h2>`,
  ];
  if (digest.results.length > 0) {
    parts.push(`<h3 style="margin:16px 0 4px">Today's matches</h3><ul style="margin:0;padding-left:20px">`);
    for (const r of digest.results) {
      parts.push(`<li><strong>${r.result}</strong> ${escapeHtml(r.label)}: ${r.us}-${r.opp}</li>`);
    }
    parts.push("</ul>");
  }
  if (digest.rankLine) parts.push(`<p style="margin:12px 0 0">${escapeHtml(digest.rankLine)}</p>`);
  if (digest.scoutingLine) parts.push(`<p style="margin:12px 0 0">${escapeHtml(digest.scoutingLine)}</p>`);
  if (aiParagraph?.trim()) parts.push(`<p style="margin:12px 0 0">${escapeHtml(aiParagraph.trim())}</p>`);
  if (digest.pointers.length > 0) {
    parts.push(`<h3 style="margin:16px 0 4px">Do better tomorrow</h3><ul style="margin:0;padding-left:20px">`);
    for (const pointer of digest.pointers) parts.push(`<li>${escapeHtml(pointer)}</li>`);
    parts.push("</ul>");
  }
  if (digest.scheduleLines.length > 0) {
    parts.push(`<h3 style="margin:16px 0 4px">Tomorrow's schedule</h3><ul style="margin:0;padding-left:20px">`);
    for (const line of digest.scheduleLines) parts.push(`<li>${escapeHtml(line)}</li>`);
    parts.push("</ul>");
  }
  parts.push(
    `<p style="margin:16px 0 0;color:#666;font-size:13px">— Vantage daily performance digest for ${escapeHtml(digest.orgName)} (${escapeHtml(digest.day)})</p>`,
  );
  return parts.join("\n");
}

/**
 * Prompt for the OPTIONAL AI paragraph. Strictly grounded: the model gets only
 * the digest facts and is told to add nothing beyond them. When no adapter
 * resolves or the call fails, the deterministic body ships without it.
 */
export function buildPerformanceDigestPrompt(digest: PerformanceDigest): string {
  const facts = renderPerformanceEmailText(digest);
  return [
    `You are writing ONE short paragraph (3-4 sentences, plain text, no markdown, no lists) for ${digest.orgName}'s daily performance email.`,
    "Use ONLY the facts below. Do not invent scores, ranks, opponents, causes, or statistics that are not literally present. Do not restate every number — summarize what mattered today and the single most useful focus for tomorrow.",
    "If the facts are thin, keep the paragraph short rather than padding it.",
    "",
    "FACTS:",
    facts,
  ].join("\n");
}
