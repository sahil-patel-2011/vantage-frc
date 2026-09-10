/**
 * summary — turnout figures that refuse to lie.
 *
 * A percentage needs BOTH sides of the ratio to be real. If nobody RSVP'd there
 * is no denominator, and if no roll call was taken there is no numerator. In
 * either case the figure is `null` WITH A NAMED REASON — never 0%, which reads
 * as "nobody came" and is the single most damaging thing this screen could say.
 *
 * There is also no hours leaderboard here, on purpose (docs/COMMUNITY_DEMAND_RND.md:
 * hour leaderboards get gamed and demoralize). Per-member totals are reported
 * against the team's OWN hour_policies goal, alphabetically, never ranked.
 *
 * Pure and dependency-free.
 */

import type { PresenceFigure, PresenceMemberRow } from "./types";
import { comingTonightCount } from "./unify";

const round2 = (value: number) => Math.round(value * 100) / 100;

export type PresenceSummaryInput = {
  rows: PresenceMemberRow[];
  rosterCount: number;
  /** A roll call exists for this occurrence (even if it lists nobody). */
  rollCallTaken: boolean;
  /** Any RSVP at all was recorded for this occurrence. */
  rsvpsRecorded: boolean;
};

export type PresenceSummary = {
  rosterCount: number;
  /** Distinct members coming or already here. RSVP + roll call + hours, counted once. */
  comingTonight: number;
  respondedCount: number;
  goingCount: number;
  maybeCount: number;
  notComingCount: number;
  presentCount: number;
  clockedCount: number;
  totalMinutes: number | null;
  noRecordCount: number;
  discrepancyCount: number;
  /** present / said-going. Null unless BOTH sides are real. */
  turnout: PresenceFigure;
  /** responded / roster. Null unless the roster is real. */
  responseRate: PresenceFigure;
};

function unavailable(reason: string): PresenceFigure {
  return { value: null, reason, label: "Not available" };
}

function percent(numerator: number, denominator: number, suffix: string): PresenceFigure {
  const value = Math.round((numerator / denominator) * 100);
  return { value, reason: null, label: `${value}% ${suffix}` };
}

export function summarizePresence(input: PresenceSummaryInput): PresenceSummary {
  const { rows, rosterCount, rollCallTaken, rsvpsRecorded } = input;

  const responded = rows.filter((row) => row.rsvp != null);
  const going = responded.filter((row) => row.rsvp === "going");
  const maybe = responded.filter((row) => row.rsvp === "maybe");
  const notComing = responded.filter((row) => row.rsvp === "no");
  const present = rows.filter((row) => row.attended === true);
  const clocked = rows.filter((row) => row.minutes != null && row.minutes > 0);

  const minutes = clocked.reduce((sum, row) => sum + (row.minutes ?? 0), 0);
  const totalMinutes = clocked.length > 0 ? round2(minutes) : null;

  const seen = new Set(rows.map((row) => row.userId));
  const noRecordCount = Math.max(0, rosterCount - seen.size);

  let turnout: PresenceFigure;
  if (!rsvpsRecorded || going.length === 0) {
    turnout = unavailable(
      "No one has RSVP'd going for this meeting, so there is no denominator to measure turnout against.",
    );
  } else if (!rollCallTaken) {
    turnout = unavailable(
      "No roll call has been taken for this meeting, so there is no count of who actually came.",
    );
  } else {
    // Both sides of the ratio must describe the SAME people: of those who said
    // going, how many the roll call actually lists. Using the whole present count
    // as the numerator would let drop-ins push turnout past 100%.
    const goingAndPresent = going.filter((row) => row.attended === true).length;
    turnout = percent(goingAndPresent, going.length, "of those who said going were on the roll call");
  }

  const responseRate =
    rosterCount > 0
      ? percent(responded.length, rosterCount, "of the roster answered")
      : unavailable("No roster members found for this team yet.");

  return {
    rosterCount,
    comingTonight: comingTonightCount(rows),
    respondedCount: responded.length,
    goingCount: going.length,
    maybeCount: maybe.length,
    notComingCount: notComing.length,
    presentCount: present.length,
    clockedCount: clocked.length,
    totalMinutes,
    noRecordCount,
    discrepancyCount: rows.filter((row) => row.discrepancy != null).length,
    turnout,
    responseRate,
  };
}

export type MemberHoursRow = {
  userId: string;
  name: string | null;
  totalHours: number;
};

export type MemberGoalRow = MemberHoursRow & {
  goalHours: number | null;
  percent: number | null;
  label: string;
};

/**
 * Per-member hours against the org's own hour_policies goal.
 *
 * Sorted BY NAME, never by hours — this is a "where am I against the goal my
 * team set" list, not a ranking. `goalHours: null` means the team has not set a
 * goal, and the label says exactly that instead of inventing one.
 */
export function memberGoalBoard(
  totals: MemberHoursRow[],
  goalHours: number | null,
): MemberGoalRow[] {
  const goal = goalHours != null && Number.isFinite(goalHours) && goalHours > 0 ? round2(goalHours) : null;
  return totals
    .map((row) => {
      const totalHours = round2(Math.max(0, row.totalHours));
      if (goal == null) {
        return {
          ...row,
          totalHours,
          goalHours: null,
          percent: null,
          label: `${totalHours} h logged · no season hour goal set for this team`,
        };
      }
      return {
        ...row,
        totalHours,
        goalHours: goal,
        percent: Math.min(100, Math.round((totalHours / goal) * 100)),
        label: `${totalHours} of ${goal} h`,
      };
    })
    .sort((a, b) => (a.name ?? a.userId).localeCompare(b.name ?? b.userId));
}

/** "2 h 45 m" · "—" when there is nothing real to show. */
export function formatMinutes(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "—";
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} m`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} m`;
}
