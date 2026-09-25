import type {
  AllianceMatchup,
  AllianceWinBreakdown,
  MatchPrediction,
  OpponentTendency,
  PickListHint,
  PrivateEdgeView,
  ScoutProvenanceRef,
  StrategyEngineSummary,
  TeamOperationalSignal,
  WinLever,
} from "@vantage/prediction-strategy";
import type { DataSourceHealthView } from "../reference-health";

export type { DataSourceHealthView };
export type { StrategyEngineSummary };

export type StrategySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
  done?: boolean;
};

export type StrategyPlaybookView = {
  title: string;
  winProbability: number;
  priorities: string[];
  /** The engine's general lines, kept for reference when `priorities` is this match's plan. */
  generalTips?: string[];
  strengthsToProtect: string[];
  risksToMitigate: string[];
  checkpoints: string[];
  debriefPrompts: string[];
  provenance: string[];
};

export type StrategyEngineeringContext = {
  jobId: string;
  title: string;
  status: string;
  platform: string;
  requirements: string[];
  constraints: string[];
  risks: string[];
  latestArtifact: { id: string; type: string; title: string; version: number } | null;
  updatedAt: string;
};

/** Kickoff game rules locked to the org active season — never prior-season mix. */
export type StrategyGameRulesContext = {
  seasonYear: number;
  status: "ready" | "empty" | "setup_required";
  message: string;
  kickoffHref: string;
  constraints: string[];
  ruleNotes: Array<{
    id: string;
    question: string;
    answer: string;
    ruleRef: string;
    status: string;
  }>;
  designPriorities: Array<{
    id: string;
    capability: string;
    rationale: string;
    weight: number;
    status: string;
  }>;
};

/** Honest TBA access / cache state — never implies live data when only env is set. */
export type TbaAccessInfo = {
  tbaConfigured: boolean;
  platformEnvKey: boolean;
  credentialAvailable: boolean;
  cacheHasSync: boolean;
};

/**
 * Honest Statbotics cache state.
 * Statbotics is public (no auth key); "available" means Neon has cached rows.
 */
export type StatboticsAccessInfo = {
  /** True when Neon has any Statbotics-sourced event or year metrics. */
  cacheHasMetrics: boolean;
  eventMetricRows: number;
  yearMetricRows: number;
};

export type ReferenceAccessInfo = TbaAccessInfo & {
  statbotics: StatboticsAccessInfo;
};

export type StrategyView =
  | {
      status: "setup_required" | "empty";
      message: string;
      steps: StrategySetupStep[];
      orgId: string | null;
      eventKey: string | null;
      eventName: string | null;
      teamNumber: number | null;
      /** Membership role, so an empty board does not send a scout to Team Data. */
      actorRole?: string | null;
      /**
       * Our most recent match at this event when none is ahead, so an empty Strategy tab can
       * offer "Review last match (Qual 36)" instead of a dead end. Absent when no match exists.
       */
      lastMatch?: { matchKey: string; compLevel: string; matchNumber: number } | null;
      tbaConfigured: boolean;
      tbaAccess?: TbaAccessInfo;
      referenceAccess?: ReferenceAccessInfo;
      /** TBA/Statbotics ingest health — strategy still uses Neon last-good when degraded. */
      dataSourceHealth?: DataSourceHealthView;
      /** Active-season kickoff rules / design priorities (empty when none for this seasonYear). */
      gameRules?: StrategyGameRulesContext;
      /** Soft-UI: which engine this org's plan entitles (never DEMO stats). */
      engine?: StrategyEngineSummary;
      productVersion?: string;
    }
  | {
      status: "live";
      orgId: string;
      eventKey: string;
      eventName: string | null;
      teamNumber: number | null;
      tbaConfigured: boolean;
      tbaAccess?: TbaAccessInfo;
      referenceAccess?: ReferenceAccessInfo;
      /** TBA/Statbotics ingest health — strategy still uses Neon last-good when degraded. */
      dataSourceHealth?: DataSourceHealthView;
      matchKey: string;
      compLevel: string;
      matchNumber: number;
      ourAlliance: "red" | "blue";
      red: string[];
      blue: string[];
      prediction: MatchPrediction;
      /** 3v3 win probability with per-team leave-one-out contribution (MODEL). */
      allianceBreakdown: AllianceWinBreakdown;
      /**
       * Ranked changes that would move this result, derived by re-running the
       * rating engine with one measured input changed. Empty when nothing about
       * our team has been measured yet — never padded with generic advice.
       */
      levers: WinLever[];
      playbook: StrategyPlaybookView;
      matchup: AllianceMatchup;
      tendencies: OpponentTendency[];
      pickListHints: PickListHint[];
      /** Which scout entries influenced reliability/foul/capability callouts. */
      scoutProvenance: ScoutProvenanceRef[];
      /** Per-team scout operational signals used by the model. */
      operations: TeamOperationalSignal[];
      /** Confirmed CAD requirements and latest artifacts durably linked to this match. */
      engineeringContext: StrategyEngineeringContext[];
      /** Active-season kickoff rules — compliance / CAD must use only this seasonYear. */
      gameRules: StrategyGameRulesContext;
      /** Org-private scouting+EPA edge (pEPA, differentials, pit pings). Empty when no real scouts. */
      privateEdge?: PrivateEdgeView;
      sources: Array<{ source: string; syncedAt: string | null; teamKey: string }>;
      computedAt: string;
      /** Soft-UI: active engine from org billing plan. */
      engine: StrategyEngineSummary;
      productVersion: string;
    };
