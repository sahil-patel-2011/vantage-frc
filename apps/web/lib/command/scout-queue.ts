export type ScoutCoverageRow = {
  teamKey: string;
  matchReports: number;
  pitReports: number;
};

export type UpcomingAllianceTeam = {
  teamKey: string;
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  scheduledTime: string | null;
  slot: "partner" | "opponent" | "us";
  matchIndex: number;
};

export type ScoutQueueCandidate = {
  teamKey: string;
  teamNumber: number | null;
  matchKey: string | null;
  matchLabel: string | null;
  priority: number;
  reasons: string[];
  hasMatchScout: boolean;
  hasPitScout: boolean;
};

function teamNumberFromKey(teamKey: string): number | null {
  const match = /^frc(\d+)$/i.exec(teamKey);
  return match ? Number(match[1]) : null;
}

/**
 * Rank who to scout next from upcoming alliance partners/opponents + coverage gaps.
 * Higher priority = scout sooner. Pure function for unit tests.
 */
export function buildScoutQueue(input: {
  ourTeamKey: string;
  upcoming: UpcomingAllianceTeam[];
  coverage: ScoutCoverageRow[];
  orgId: string;
  limit?: number;
}): ScoutQueueCandidate[] {
  const limit = input.limit ?? 8;
  const byTeam = new Map(input.coverage.map((row) => [row.teamKey, row]));
  const best = new Map<string, ScoutQueueCandidate>();

  for (const row of input.upcoming) {
    if (row.teamKey === input.ourTeamKey || row.slot === "us") continue;
    const cov = byTeam.get(row.teamKey) ?? { teamKey: row.teamKey, matchReports: 0, pitReports: 0 };
    const hasMatchScout = cov.matchReports > 0;
    const hasPitScout = cov.pitReports > 0;
    const reasons: string[] = [];
    let priority = 0;

    // Next match first
    priority += Math.max(0, 40 - row.matchIndex * 12);
    if (row.slot === "opponent") {
      priority += 18;
      reasons.push("Upcoming opponent");
    } else {
      priority += 10;
      reasons.push("Alliance partner");
    }
    if (!hasMatchScout) {
      priority += 28;
      reasons.push("No match scout reports yet");
    } else if (cov.matchReports < 2) {
      priority += 12;
      reasons.push(`Thin match coverage (${cov.matchReports})`);
    }
    if (!hasPitScout) {
      priority += 16;
      reasons.push("No pit scout entry");
    }
    const matchLabel = `${row.compLevel.toUpperCase()} ${row.matchNumber}`;
    const existing = best.get(row.teamKey);
    const candidate: ScoutQueueCandidate = {
      teamKey: row.teamKey,
      teamNumber: teamNumberFromKey(row.teamKey),
      matchKey: row.matchKey,
      matchLabel,
      priority,
      reasons,
      hasMatchScout,
      hasPitScout,
    };
    if (!existing || candidate.priority > existing.priority) {
      best.set(row.teamKey, candidate);
    }
  }

  // Also surface event-wide gaps not yet in upcoming alliances (low priority fill)
  for (const cov of input.coverage) {
    if (cov.teamKey === input.ourTeamKey) continue;
    if (best.has(cov.teamKey)) continue;
    if (cov.matchReports > 0 && cov.pitReports > 0) continue;
    if (cov.matchReports === 0 && cov.pitReports === 0) continue; // unknown teams without schedule touch
  }

  return [...best.values()]
    .sort((a, b) => b.priority - a.priority || (a.teamNumber ?? 0) - (b.teamNumber ?? 0))
    .slice(0, limit)
    .map((item) => ({
      ...item,
      // formHref filled by caller with orgId
    }));
}

export function withScoutFormHrefs(
  items: ScoutQueueCandidate[],
  orgId: string,
): Array<ScoutQueueCandidate & { formHref: string }> {
  return items.map((item) => {
    const params = new URLSearchParams({ orgId });
    params.set("teamKey", item.teamKey);
    if (item.matchKey) params.set("matchKey", item.matchKey);
    return { ...item, formHref: `/scouting?${params.toString()}` };
  });
}

export { teamNumberFromKey };
