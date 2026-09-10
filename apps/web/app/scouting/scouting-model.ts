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
  }>;
  scoutIdentity?: ScoutIdentity;
};

export type ScoutTab = "match" | "pit" | "conflicts" | "handoff" | "trust";

export type RecentEntry = NonNullable<Bootstrap["recentEntries"]>[number];

/**
 * CSV shape of the recent-entries feed — the raw scouting rows teams otherwise
 * re-type into a Sheet. Identity, source, and confidence travel with the row so an
 * exported file is still auditable outside Vantage.
 */
export const SCOUT_ENTRY_CSV_COLUMNS: CsvColumn<RecentEntry>[] = [
  { key: "matchKey", header: "Match", hint: "Blank for pit entries", value: (entry) => entry.matchKey },
  { key: "teamKey", header: "Team", hint: "TBA team key, e.g. frc1678", value: (entry) => entry.teamKey },
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
