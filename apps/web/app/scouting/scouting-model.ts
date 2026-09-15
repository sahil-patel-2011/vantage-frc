import type { ScoutSchema, ScoutIdentity } from "@vantage/scouting";
import type { FieldTrustSummary } from "@vantage/scouting/trust";

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
    payload?: Record<string, unknown> | null;
  }>;
  scoutIdentity?: ScoutIdentity;
};

export type ScoutTab = "match" | "pit" | "conflicts" | "handoff" | "trust";

export type RecentEntry = NonNullable<Bootstrap["recentEntries"]>[number];

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
