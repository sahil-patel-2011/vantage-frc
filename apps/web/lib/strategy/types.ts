import type {
  AllianceMatchup,
  AllianceWinBreakdown,
  MatchPrediction,
  OpponentTendency,
  PickListHint,
  ScoutProvenanceRef,
  TeamOperationalSignal,
} from "@vantage/prediction-strategy";

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
  strengthsToProtect: string[];
  risksToMitigate: string[];
  checkpoints: string[];
  debriefPrompts: string[];
  provenance: string[];
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
      tbaConfigured: boolean;
      tbaAccess?: TbaAccessInfo;
      referenceAccess?: ReferenceAccessInfo;
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
      matchKey: string;
      compLevel: string;
      matchNumber: number;
      ourAlliance: "red" | "blue";
      red: string[];
      blue: string[];
      prediction: MatchPrediction;
      /** 3v3 win probability with per-team leave-one-out contribution (MODEL). */
      allianceBreakdown: AllianceWinBreakdown;
      playbook: StrategyPlaybookView;
      matchup: AllianceMatchup;
      tendencies: OpponentTendency[];
      pickListHints: PickListHint[];
      /** Which scout entries influenced reliability/foul/capability callouts. */
      scoutProvenance: ScoutProvenanceRef[];
      /** Per-team scout operational signals used by the model. */
      operations: TeamOperationalSignal[];
      sources: Array<{ source: string; syncedAt: string | null; teamKey: string }>;
      computedAt: string;
    };
