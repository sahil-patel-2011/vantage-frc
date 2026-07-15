import type { MatchPrediction } from "@vantage/prediction-strategy";

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
    }
  | {
      status: "live";
      orgId: string;
      eventKey: string;
      eventName: string | null;
      teamNumber: number | null;
      tbaConfigured: boolean;
      matchKey: string;
      compLevel: string;
      matchNumber: number;
      prediction: MatchPrediction;
      playbook: StrategyPlaybookView;
      sources: Array<{ source: string; syncedAt: string | null; teamKey: string }>;
      computedAt: string;
    };
