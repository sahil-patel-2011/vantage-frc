// Match Copilot domain types. Pure data shapes — no I/O, no framework imports.
// Between-matches copilot: a glanceable brief for the NEXT match fusing opponent
// scouting/EPA, our stored strategy plan, our OPEN FMEA risks, and live battery
// fleet health into up to 3 prioritized do-this callouts.

export type MatchCopilotAlliance = "red" | "blue";

export type MatchCopilotTeam = {
  teamKey: string;
  teamNumber: number;
  nickname: string | null;
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  rank: number | null;
};

export type MatchCopilotRisk = {
  id: string;
  subsystemName: string;
  title: string;
  occurrence: number;
  severity: number;
  detection: number;
  rpn: number;
  status: string;
};

export type BatteryHealthFlag = "healthy" | "watch" | "critical";

export type MatchCopilotBattery = {
  id: string;
  label: string;
  status: string;
  restingVoltage: number | null;
  resistanceMilliohms: number | null;
  healthScore: number;
  flag: BatteryHealthFlag;
};

export type MatchCopilotCalloutCategory = "opponent" | "strategy" | "risk" | "battery";

export type MatchCopilotCallout = {
  priority: 1 | 2 | 3;
  category: MatchCopilotCalloutCategory;
  headline: string;
  detail: string;
  sourceRefs: string[];
};

export type MatchCopilotSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MatchCopilotView =
  | {
      status: "setup_required";
      message: string;
      steps: MatchCopilotSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number;
      eventKey: string;
      eventName: string | null;
      matchKey: string;
      compLevel: string;
      matchNumber: number;
      scheduledTime: string | null;
      alliance: MatchCopilotAlliance;
      opponents: MatchCopilotTeam[];
      allies: MatchCopilotTeam[];
      ourEpaTotal: number | null;
      hasStrategyPlan: boolean;
      strategySummary: string | null;
      openRisks: MatchCopilotRisk[];
      batteryFleet: MatchCopilotBattery[];
      callouts: MatchCopilotCallout[];
      generatedBy: "ai" | "local";
      computedAt: string;
    };
