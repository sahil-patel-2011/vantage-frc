import type { OpponentTendency, MatchPrediction, AllianceMatchup } from "@vantage/prediction-strategy";
import type { FullBriefingView } from "../briefing/types";
import type { DataSourceHealthView } from "../reference-health";
import type { NexusQueueSnapshot } from "./nexus-queue";
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
  source: "pit" | "match_scout" | "maintenance" | "battery" | "fmea_repeat";
};

export type DriveCoachBrief = {
  teamKey: string;
  teamNumber: number | null;
  labels: string[];
  evidence: string[];
  capabilities: string[];
};

export type CommandMyDay = {
  bumperCue: string | null;
  ourAlliance: "red" | "blue" | null;
  lodgingLabel: string | null;
  nextTravelLabel: string | null;
  onDutyLabel: string | null;
  checklistPercent: number | null;
  href: string;
};

export type CommandNexus = {
  nowQueuing: string | null;
  queuedMatchKey: string | null;
  pitCount: number;
  syncedAt: string | null;
  attributionHref: string;
  /** False when no Nexus API key is configured — the panel shows setup guidance. */
  configured: boolean;
  /** Queue countdown, announcements, and parts requests. Null until a payload is cached. */
  queue: NexusQueueSnapshot | null;
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
  /** TBA/Statbotics ingest health — command keeps serving Neon last-good when degraded. */
  dataSourceHealth?: DataSourceHealthView;
  setupSteps: Array<{ id: string; label: string; detail: string; href: string; done?: boolean }>;
  matches: CommandMatch[];
  scoutQueue: ScoutQueueItem[];
  briefs: DriveCoachBrief[];
  pitFlags: PitFlag[];
  /** Personal next-match / bumper / travel strip. */
  myDay: CommandMyDay | null;
  /** Nexus queue/pits from worker cache — null until a snapshot exists. */
  nexus: CommandNexus | null;
  /**
   * THE pre-match briefing for the focus match (lib/briefing/compute-briefing). Command
   * renders its pre-match section from this payload so /command and /briefing cannot
   * disagree. Null when the briefing could not be computed (no event / no team number).
   */
  briefing: FullBriefingView | null;
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
    /** Per-robot rows for now/next/after matches (CD #5 live board). */
    missingRows: number;
    assignedWaiting: number;
    coveredRows: number;
    doubleCovered: number;
    liveBoard: Array<{
      matchKey: string;
      matchNumber: number;
      compLevel: string;
      teamKey: string;
      teamNumber: number | null;
      assignmentCount: number;
      entryCount: number;
      state: "missing" | "assigned" | "covered" | "double_covered";
    }>;
    coordinatorNudge: {
      status: "skipped" | "sent" | "throttled" | "no_gaps" | "forbidden";
      missingRows: number;
      message?: string;
    } | null;
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
    pit: string;
    batteries: string;
    myDay: string;
    logistics: string;
    schedule: string;
    matchChecklist: string;
  };
};
