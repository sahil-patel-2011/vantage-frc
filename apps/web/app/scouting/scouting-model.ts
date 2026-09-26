import type { ScoutSchema, ScoutIdentity } from "@vantage/scouting";
import type { FieldTrustSummary } from "@vantage/scouting/trust";
import type { CsvColumn } from "../../lib/export/to-csv";

export type OfficialFlag = {
  fieldKey: string;
  status: string;
  scoutValue: unknown;
  officialValue: unknown;
  officialSource: string;
  detail: string;
  soft?: boolean;
};

export type Bootstrap = {
  eventKey: string | null;
  eventName?: string | null;
  schemas: ScoutSchema[];
  canManageSchemas?: boolean;
  assignments: Array<{
    matchKey: string;
    teamKey: string;
    compLevel: string;
    matchNumber: number;
  }>;
  matches: Array<{
    matchKey: string;
    matchNumber: number;
    compLevel?: string;
    redAlliance?: { teamKeys?: string[] };
    blueAlliance?: { teamKeys?: string[] };
    /** When the match ran or will run; the bootstrap sends it. */
    matchTime?: string | null;
  }>;
  recentEntries: Array<{
    id: string;
    type: string;
    matchKey: string | null;
    teamKey: string;
    confidence: string;
    source: string;
    updatedAt: string;
    scoutName: string;
    scoutUserId?: string;
    payload?: Record<string, unknown> | null;
    /** Saving again with this id replaces the entry (the author may update their own). */
    clientId?: string | null;
  }>;
  scoutIdentity?: ScoutIdentity;
};

export type ScoutTab = "match" | "pit" | "conflicts" | "handoff" | "trust" | "teams";

/** A match is over five minutes after its time (the same rule the match picker uses). */
const PLAYED_AFTER_MS = 5 * 60_000;

/**
 * The assignment the Scout tab should open on: the first one whose match has not been played and
 * whose robot nobody has scouted yet. Opening on assignments[0] put a scout on Qual 1, eleven
 * hours over and already scouted, with their old report loaded, and they saved it a second time.
 * Null when every assignment is done or over; the match picker then chooses.
 */
export function openAssignment(
  data: Pick<Bootstrap, "assignments" | "matches" | "recentEntries">,
  nowMs: number,
): Bootstrap["assignments"][number] | null {
  const scouted = new Set(
    data.recentEntries.filter((entry) => entry.type === "match" && entry.matchKey).map((entry) => `${entry.matchKey}|${entry.teamKey}`),
  );
  const timeOf = new Map(data.matches.map((match) => [match.matchKey, match.matchTime ?? null]));
  return (
    data.assignments.find((assignment) => {
      if (scouted.has(`${assignment.matchKey}|${assignment.teamKey}`)) return false;
      const time = timeOf.get(assignment.matchKey);
      const at = time ? Date.parse(time) : Number.NaN;
      return !Number.isFinite(at) || at + PLAYED_AFTER_MS > nowMs;
    }) ?? null
  );
}

/** What the confirmation after Save says. `next` is only set when the schedule or an assignment names it. */
export type SaveReceipt = {
  teamKey: string;
  matchKey?: string;
  /** "Qual 10", read the same way the robot tiles read it. */
  matchLabel?: string | null;
  entryType: "match" | "pit";
  offline: boolean;
  /** Tells two saves of the same robot apart, so each one scrolls to its confirmation. */
  savedAt: number;
  next?: { matchLabel: string; teamNumber: string | null; stationLabel: string | null } | null;
};

export type RecentEntry = NonNullable<Bootstrap["recentEntries"]>[number];

/**
 * CSV shape of the recent-entries feed — the raw scouting rows teams otherwise
 * re-type into a Sheet. Identity, source, and confidence travel with the row so an
 * exported file is still auditable outside Vantage.
 */
export const SCOUT_ENTRY_CSV_COLUMNS: CsvColumn<RecentEntry>[] = [
  { key: "matchKey", header: "Match", hint: "Blank for pit entries", value: (entry) => entry.matchKey },
  { key: "teamKey", header: "Team", hint: "Team number, e.g. 1678", value: (entry) => entry.teamKey },
  { key: "type", header: "Type", hint: "match or pit" },
  { key: "scoutName", header: "Scout", hint: "Who submitted it" },
  { key: "source", header: "Source", hint: "How it arrived (form, QR handoff, sync)" },
  { key: "confidence", header: "Confidence", hint: "Scout's own confidence flag" },
  {
    key: "updatedAt",
    header: "Updated at",
    hint: "ISO-8601 UTC — latest timestamp wins per entry",
    value: (entry) => entry.updatedAt,
  },
];

export type ConflictCandidate = {
  entryId: string;
  value: unknown;
  scoutName?: string | null;
  confidence?: string | null;
};

export type TrustSnapshot = {
  fieldTrust: FieldTrustSummary[];
  leaderboard: Array<{
    userId: string;
    name: string;
    entries: number;
    checks: number;
    matches: number;
    conflicts: number;
    accuracy: number | null;
  }>;
};
