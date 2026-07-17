import type { OpponentTendency, MatchPrediction, AllianceMatchup } from "@vantage/prediction-strategy";
import type { StrategyPlaybookView, TbaAccessInfo } from "../strategy/types";

export type CommandMatchAlliance = {
  teamKeys: string[];
  score?: number | null;
};

export type CommandMatch = {
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  scheduledTime: string | null;
  predictedTime: string | null;
  ourAlliance: "red" | "blue" | null;
  red: CommandMatchAlliance;
  blue: CommandMatchAlliance;
  label: "now" | "next" | "after";
};

export type ScoutQueueItem = {
  teamKey: string;
  teamNumber: number | null;
  matchKey: string | null;
  matchLabel: string | null;
  priority: number;
  reasons: string[];
  hasMatchScout: boolean;
  hasPitScout: boolean;
  formHref: string;
};

export type PitFlag = {
  teamKey: string;
  teamNumber: number | null;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  evidence: string;
  source: "pit" | "match_scout" | "maintenance";
};

export type DriveCoachBrief = {
  teamKey: string;
  teamNumber: number | null;
  labels: string[];
  evidence: string[];
  capabilities: string[];
};

export type CommandSnapshot = {
  status: "live" | "setup_required" | "empty";
  message?: string;
  computedAt: string;
  orgId: string | null;
  role: string | null;
  canSetEvent: boolean;
  orgName: string | null;
  teamNumber: number | null;
  teamKey: string | null;
  eventKey: string | null;
  eventName: string | null;
  tbaConfigured: boolean;
  tbaAccess?: TbaAccessInfo;
  setupSteps: Array<{ id: string; label: string; detail: string; href: string; done?: boolean }>;
  matches: CommandMatch[];
  scoutQueue: ScoutQueueItem[];
  briefs: DriveCoachBrief[];
  pitFlags: PitFlag[];
  prediction: {
    status: "live" | "empty" | "setup_required";
    matchKey: string | null;
    modelVersion: string | null;
    pOur: number | null;
    pOpp: number | null;
    confidenceLow: number | null;
    confidenceHigh: number | null;
    caveats: string[];
    keyFactors: Array<{ name: string; evidence: string; kind?: string }>;
    matchup: AllianceMatchup | null;
    playbook: StrategyPlaybookView | null;
    tendencies: OpponentTendency[];
    fullPrediction: MatchPrediction | null;
  };
  record: {
    status: "live" | "empty" | "setup_required";
    wins: number | null;
    losses: number | null;
    ties: number | null;
    rank: number | null;
    epaTotal: number | null;
    source: string | null;
    syncedAt: string | null;
  };
  coverage: {
    matchReports: number;
    pitReports: number;
    openDisagreements: number;
    upcomingUnscouted: number;
  };
  links: {
    strategy: string;
    scouting: string;
    messages: string;
    intel: string;
    workspace: string;
    teamData: string;
    display: string;
    chemistry: string;
  };
};
