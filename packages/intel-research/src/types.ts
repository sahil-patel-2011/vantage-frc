export type Metric = {
  eventKey?: string;
  year: number;
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  opr?: number | null;
  dpr?: number | null;
  rank?: number | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  source: string;
};

export type Finding = {
  id?: string;
  sourceUrl: string;
  sourceTitle?: string | null;
  sourceType: "cd_post" | "social" | "news" | "reveal_video" | "team_site" | "other";
  summary: string;
  confidence: number;
  publishedAt: string | Date | null;
  foundAt: string | Date;
  extractedFacts: Array<{ claim: string; confidence: number; evidence?: string }>;
};

export type ScoutObservation = {
  payload: Record<string, unknown>;
  confidence: "high" | "normal" | "low";
  matchKey?: string;
};

export type SearchResult = {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
  sourceType?: Finding["sourceType"];
};

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, options: { limit: number; signal?: AbortSignal }): Promise<SearchResult[]>;
}

export interface SummaryProvider {
  readonly name: string;
  summarize(input: {
    teamNumber: number;
    nickname: string | null;
    metrics: Metric[];
    findings: Finding[];
    scoutObservations: ScoutObservation[];
  }): Promise<{
    text: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    model: string;
  }>;
}

export type TeamIntel = {
  team: {
    teamKey: string;
    teamNumber: number;
    nickname: string | null;
    name: string;
    city: string | null;
    stateProv: string | null;
    country: string | null;
    rookieYear: number | null;
  };
  atActiveEvent: boolean;
  metrics: Metric[];
  findings: Finding[];
  trajectory: Array<{ year: number; epa: number }>;
  archetypes: string[];
  reliability: {
    score: number | null;
    consistency: number | null;
    sampleSize: number;
    evidence: string;
  };
  foulRisk: {
    level: "low" | "medium" | "high" | "unknown";
    rate: number | null;
    sampleSize: number;
    evidence: string;
  };
};
