import type {
  AllianceMatchup,
  MatchPrediction,
  OpponentTendency,
  PickListHint,
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

export type TbaAccessInfo = {
  tbaConfigured: boolean;
  platformEnvKey: boolean;
  credentialAvailable: boolean;
  cacheHasSync: boolean;
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
    }
  | {
      status: "live";
      orgId: string;
      eventKey: string;
      eventName: string | null;
      teamNumber: number | null;
      tbaConfigured: boolean;
      tbaAccess?: TbaAccessInfo;
      matchKey: string;
      compLevel: string;
      matchNumber: number;
      ourAlliance: "red" | "blue";
      red: string[];
      blue: string[];
      prediction: MatchPrediction;
      playbook: StrategyPlaybookView;
      matchup: AllianceMatchup;
      tendencies: OpponentTendency[];
      pickListHints: PickListHint[];
      sources: Array<{ source: string; syncedAt: string | null; teamKey: string }>;
      computedAt: string;
    };
