// Alliance-partner brief domain types. Pure data shapes — no I/O, no framework imports.
// Once an alliance board's selection is finalized, this summarizes the actual partners
// (not hypothetical pick-list slots) — role on the field, strengths, and the evidence behind
// each claim (event metrics source + scouting coverage). Never fabricated: a team with no
// metrics and no scouting simply shows "unproven" with zero evidence, not invented numbers.

export type PartnerRole =
  | "auto_specialist"
  | "teleop_scorer"
  | "endgame_specialist"
  | "balanced_scorer"
  | "defense_support"
  | "unproven";

export type PartnerEpa = {
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  rank: number | null;
  wins: number;
  losses: number;
  ties: number;
  source: string;
};

export type PartnerAnalysis = {
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  slot: "captain" | "first" | "second";
  role: PartnerRole;
  roleLabel: string;
  strengths: string[];
  epa: PartnerEpa | null;
  matchScoutEntryCount: number;
  pitScoutEntryCount: number;
  evidenceNote: string;
};

export type AllianceBriefSummary = {
  id: string;
  eventKey: string;
  allianceSeed: number;
  ourTeamKey: string;
  partnerTeamKeys: string[];
  partners: PartnerAnalysis[];
  generatedAt: string;
};

export type AllianceOption = {
  seed: number;
  captainTeamKey: string | null;
  firstPickTeamKey: string | null;
  secondPickTeamKey: string | null;
  isOurAlliance: boolean;
};

export type AlliancePartnerBriefSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type AlliancePartnerBriefView =
  | {
      status: "setup_required";
      message: string;
      steps: AlliancePartnerBriefSetupStep[];
      orgId: string | null;
      eventKey: string | null;
    }
  | {
      status: "live";
      orgId: string;
      eventKey: string;
      eventName: string | null;
      allianceBoardId: string;
      allianceBoardName: string;
      ourTeamKey: string | null;
      alliances: AllianceOption[];
      selectedSeed: number | null;
      brief: AllianceBriefSummary | null;
      computedAt: string;
    };
