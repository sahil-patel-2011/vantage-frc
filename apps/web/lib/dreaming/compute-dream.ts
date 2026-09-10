/**
 * Nightly team "dreaming" — pure digest types, prompt assembly, and the
 * deterministic no-AI fallback.
 *
 * Everything in this module renders ONLY facts already gathered from real rows
 * by run-dream.ts. No DB, no fetch, no clock reads — fully unit-testable.
 * Never invent data: a fact absent from the digest simply is not rendered.
 */

export type DreamMessage = {
  author: string;
  /** Already clamped to MESSAGE_EXCERPT_CHARS by the gatherer. */
  excerpt: string;
};

export type DreamScoutingEvent = {
  eventKey: string;
  matchEntries: number;
  pitEntries: number;
};

export type DreamDecision = { title: string; category: string; status: string };

export type DreamTask = {
  title: string;
  source: "build" | "todo";
  subsystem: string | null;
};

export type DreamCalendarEvent = { title: string; kind: string };

export type DreamIncident = {
  title: string;
  kind: "safety_incident" | "pit_repair";
  action: "opened" | "resolved";
};

export type DreamCadJob = { title: string; platform: string; status: string };

/** One member's closed shop time for the window. */
export type DreamHourMember = { name: string; hours: number };

/** "Call your shot" learning ledger tally for the window. */
export type DreamPredictionTally = {
  calls: number;
  graded: number;
  spotOn: number;
  close: number;
  off: number;
  skipped: number;
};

export type DreamMatchResult = {
  /** e.g. "qm42" — the TBA match key suffix, already human-ish. */
  matchLabel: string;
  ourAlliance: "red" | "blue";
  ourScore: number | null;
  theirScore: number | null;
  outcome: "win" | "loss" | "tie" | "unknown";
};

export type DreamBugReport = { severity: string | null; area: string | null; summary: string };

/** A funding deadline that crossed into the 14-day window on this day. */
export type DreamGrantDeadline = {
  name: string;
  funder: string | null;
  /** YYYY-MM-DD. */
  closesOn: string;
};

export type DreamDigest = {
  orgName: string;
  /** UTC calendar day the recap is filed under (YYYY-MM-DD). */
  day: string;
  messages: { count: number; recent: DreamMessage[] };
  scouting: { total: number; byEvent: DreamScoutingEvent[] };
  decisions: { count: number; items: DreamDecision[] };
  tasksCompleted: { count: number; items: DreamTask[] };
  calendarEvents: { count: number; items: DreamCalendarEvent[] };
  incidents: { openedCount: number; resolvedCount: number; items: DreamIncident[] };
  cadJobs: { count: number; items: DreamCadJob[] };
  hours: { sessions: number; totalHours: number; members: DreamHourMember[] };
  predictions: DreamPredictionTally;
  matchResults: {
    eventKey: string | null;
    wins: number;
    losses: number;
    ties: number;
    items: DreamMatchResult[];
  };
  bugs: { count: number; items: DreamBugReport[] };
  grantDeadlines: { count: number; items: DreamGrantDeadline[] };
};

export const MESSAGE_EXCERPT_CHARS = 120;

export function emptyPredictionTally(): DreamPredictionTally {
  return { calls: 0, graded: 0, spotOn: 0, close: 0, off: 0, skipped: 0 };
}

export function emptyDreamDigest(orgName: string, day: string): DreamDigest {
  return {
    orgName,
    day,
    messages: { count: 0, recent: [] },
    scouting: { total: 0, byEvent: [] },
    decisions: { count: 0, items: [] },
    tasksCompleted: { count: 0, items: [] },
    calendarEvents: { count: 0, items: [] },
    incidents: { openedCount: 0, resolvedCount: 0, items: [] },
    cadJobs: { count: 0, items: [] },
    hours: { sessions: 0, totalHours: 0, members: [] },
    predictions: emptyPredictionTally(),
    matchResults: { eventKey: null, wins: 0, losses: 0, ties: 0, items: [] },
    bugs: { count: 0, items: [] },
    grantDeadlines: { count: 0, items: [] },
  };
}

/**
 * Share of graded calls that landed spot-on or close. `null` when nothing was
 * graded — a hit rate from zero calls would be an invented number.
 */
export function predictionHitRate(tally: DreamPredictionTally): number | null {
  if (tally.graded <= 0) return null;
  return (tally.spotOn + tally.close) / tally.graded;
}

/** One decimal, no trailing ".0" — "3.5" / "12". */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Derive win/loss/tie from TBA's `winning_alliance` (which is `''` for a tie
 * and may be absent while results are still posting). Falls back to comparing
 * posted scores; when neither is available the outcome stays `unknown` rather
 * than being guessed either way.
 */
export function matchOutcome(input: {
  ourAlliance: "red" | "blue";
  winningAlliance: string | null;
  ourScore: number | null;
  theirScore: number | null;
}): DreamMatchResult["outcome"] {
  const winner = (input.winningAlliance ?? "").trim().toLowerCase();
  if (winner === "red" || winner === "blue") {
    return winner === input.ourAlliance ? "win" : "loss";
  }
  if (input.ourScore === null || input.theirScore === null) return "unknown";
  if (input.ourScore > input.theirScore) return "win";
  if (input.ourScore < input.theirScore) return "loss";
  return "tie";
}

/** Collapse whitespace and clamp to `max` characters (ellipsis when cut). */
export function clampExcerpt(text: string, max = MESSAGE_EXCERPT_CHARS): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** True when any real activity was recorded. Idle days must write nothing. */
export function hasActivity(digest: DreamDigest): boolean {
  return (
    digest.messages.count > 0 ||
    digest.scouting.total > 0 ||
    digest.decisions.count > 0 ||
    digest.tasksCompleted.count > 0 ||
    digest.calendarEvents.count > 0 ||
    digest.incidents.openedCount > 0 ||
    digest.incidents.resolvedCount > 0 ||
    digest.cadJobs.count > 0 ||
    digest.hours.sessions > 0 ||
    digest.predictions.calls > 0 ||
    digest.matchResults.items.length > 0 ||
    digest.bugs.count > 0 ||
    digest.grantDeadlines.count > 0
  );
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Renders the digest's facts as plain-text sections. Shared by the model
 * prompt and the deterministic fallback so both are grounded in the exact
 * same fact list. Empty sections are omitted entirely.
 */
export function renderDigestFacts(digest: DreamDigest): string {
  const sections: string[] = [];

  if (digest.messages.count > 0) {
    const lines = digest.messages.recent.map(
      (message) => `- ${message.author}: ${message.excerpt}`,
    );
    sections.push(
      [
        `Team chat: ${pluralize(digest.messages.count, "message")} posted.` +
          (digest.messages.recent.length < digest.messages.count
            ? ` Most recent ${digest.messages.recent.length}:`
            : ""),
        ...lines,
      ].join("\n"),
    );
  }

  if (digest.scouting.total > 0) {
    const lines = digest.scouting.byEvent.map((event) => {
      const parts: string[] = [];
      if (event.matchEntries > 0) parts.push(pluralize(event.matchEntries, "match entry", "match entries"));
      if (event.pitEntries > 0) parts.push(pluralize(event.pitEntries, "pit entry", "pit entries"));
      return `- ${event.eventKey}: ${parts.join(", ")}`;
    });
    sections.push([`Scouting: ${pluralize(digest.scouting.total, "entry", "entries")} recorded.`, ...lines].join("\n"));
  }

  if (digest.decisions.count > 0) {
    const lines = digest.decisions.items.map(
      (decision) => `- ${decision.title} (${decision.category}, ${decision.status})`,
    );
    sections.push([`Decisions logged: ${digest.decisions.count}.`, ...lines].join("\n"));
  }

  if (digest.tasksCompleted.count > 0) {
    const lines = digest.tasksCompleted.items.map((task) => {
      const scope = task.source === "build" && task.subsystem ? ` [${task.subsystem}]` : "";
      return `- ${task.title}${scope}`;
    });
    sections.push([`Tasks completed: ${digest.tasksCompleted.count}.`, ...lines].join("\n"));
  }

  if (digest.calendarEvents.count > 0) {
    const lines = digest.calendarEvents.items.map((event) => `- ${event.title} (${event.kind})`);
    sections.push([`Calendar events held: ${digest.calendarEvents.count}.`, ...lines].join("\n"));
  }

  if (digest.incidents.openedCount > 0 || digest.incidents.resolvedCount > 0) {
    const lines = digest.incidents.items.map((incident) => {
      const label = incident.kind === "pit_repair" ? "pit repair" : "incident";
      return `- ${incident.action}: ${incident.title} (${label})`;
    });
    sections.push(
      [
        `Incidents & pit repairs: ${digest.incidents.openedCount} opened, ${digest.incidents.resolvedCount} resolved.`,
        ...lines,
      ].join("\n"),
    );
  }

  if (digest.cadJobs.count > 0) {
    const lines = digest.cadJobs.items.map(
      (job) => `- ${job.title} (${job.platform}, ${job.status})`,
    );
    sections.push([`CAD agent jobs: ${digest.cadJobs.count}.`, ...lines].join("\n"));
  }

  if (digest.hours.sessions > 0) {
    const lines = digest.hours.members.map(
      (member) => `- ${member.name}: ${formatHours(member.hours)} h`,
    );
    sections.push(
      [
        `Shop hours logged: ${formatHours(digest.hours.totalHours)} h across ` +
          `${pluralize(digest.hours.sessions, "closed session")}.`,
        ...lines,
      ].join("\n"),
    );
  }

  if (digest.predictions.calls > 0) {
    const rate = predictionHitRate(digest.predictions);
    const detail: string[] = [];
    if (digest.predictions.graded > 0) {
      detail.push(
        `${digest.predictions.spotOn} spot-on, ${digest.predictions.close} close, ` +
          `${digest.predictions.off} off`,
      );
    }
    if (digest.predictions.skipped > 0) {
      detail.push(`${digest.predictions.skipped} skipped`);
    }
    const rateLine =
      rate === null
        ? "No graded calls, so no hit rate."
        : `Hit rate (spot-on or close): ${Math.round(rate * 100)}%.`;
    sections.push(
      [
        `Call-your-shot: ${pluralize(digest.predictions.calls, "call")} recorded` +
          (detail.length ? ` — ${detail.join(", ")}.` : "."),
        rateLine,
      ].join("\n"),
    );
  }

  if (digest.matchResults.items.length > 0) {
    const lines = digest.matchResults.items.map((match) => {
      const score =
        match.ourScore === null || match.theirScore === null
          ? "score not posted"
          : `${match.ourScore}-${match.theirScore}`;
      return `- ${match.matchLabel} (${match.ourAlliance}): ${match.outcome}, ${score}`;
    });
    const record = `${digest.matchResults.wins}-${digest.matchResults.losses}-${digest.matchResults.ties}`;
    sections.push(
      [
        `Match results${digest.matchResults.eventKey ? ` at ${digest.matchResults.eventKey}` : ""}: ` +
          `${record} (W-L-T) over ${pluralize(digest.matchResults.items.length, "match", "matches")}.`,
        ...lines,
      ].join("\n"),
    );
  }

  if (digest.bugs.count > 0) {
    const lines = digest.bugs.items.map((bug) => {
      const tags = [bug.severity, bug.area].filter(Boolean).join(", ");
      return `- ${bug.summary}${tags ? ` (${tags})` : ""}`;
    });
    sections.push(
      [`Bug reports filed: ${digest.bugs.count}.`, ...lines].join("\n"),
    );
  }

  if (digest.grantDeadlines.count > 0) {
    const lines = digest.grantDeadlines.items.map((grant) => {
      const funder = grant.funder ? ` — ${grant.funder}` : "";
      return `- ${grant.name}${funder}: closes ${grant.closesOn}`;
    });
    sections.push(
      [
        `Funding deadlines now inside 14 days: ${digest.grantDeadlines.count}.`,
        ...lines,
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

/**
 * Prompt for the org's own chat adapter. The model must write tomorrow's
 * team memory grounded ONLY in the listed facts — an explicit never-invent
 * instruction is part of the contract, and output length is capped by asking
 * for a short recap (the HTTP adapters also hard-cap completion tokens).
 */
export function assembleDreamPrompt(digest: DreamDigest): string {
  return [
    `You are consolidating one day of activity for the FRC team "${digest.orgName}" into their team memory.`,
    `Write a compact end-of-day recap for ${digest.day} with exactly these four short sections:`,
    "1. What happened",
    "2. What changed",
    "3. Open threads",
    "4. What tomorrow-you should know",
    "",
    "Grounding rules (mandatory):",
    "Use ONLY the facts listed below.",
    "- If a fact is not listed below, it did not happen — do not speculate about it.",
    '- If a section has no supporting facts, write exactly "Nothing recorded."',
    "- Plain text only, no markdown headings, under 300 words total.",
    "",
    `Facts recorded on ${digest.day}:`,
    renderDigestFacts(digest),
  ].join("\n");
}

/**
 * No-AI fallback: the same facts rendered as structured plain text. Fully
 * deterministic for a given digest — no clock, no randomness, no prose that
 * goes beyond the recorded rows.
 */
export function deterministicDigest(digest: DreamDigest): string {
  return [
    `Team recap for ${digest.day} — ${digest.orgName} (auto-generated from recorded activity; no AI summary available).`,
    "",
    renderDigestFacts(digest),
  ].join("\n");
}
