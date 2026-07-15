export type SyncSource = "tba" | "statbotics";

export type SyncCursor = {
  source: SyncSource;
  resource: string;
  etag: string | null;
  lastModified: string | null;
  cursor: string | null;
  lastStatus: number | null;
  lastError: string | null;
  syncedAt: Date | null;
  updatedAt: Date;
};

export type TeamRecord = {
  teamKey: string;
  teamNumber: number;
  nickname: string | null;
  name: string;
  city: string | null;
  stateProv: string | null;
  country: string | null;
  postalCode: string | null;
  rookieYear: number | null;
  website: string | null;
  syncedAt: Date;
};

export type EventRecord = {
  eventKey: string;
  year: number;
  name: string;
  shortName: string | null;
  startDate: string | null;
  endDate: string | null;
  eventType: number | null;
  week: number | null;
  districtKey: string | null;
  city: string | null;
  stateProv: string | null;
  country: string | null;
  address: string | null;
  postalCode: string | null;
  timezone: string | null;
  website: string | null;
  parentEventKey: string | null;
  webcasts: Array<Record<string, unknown>>;
  syncedAt: Date;
};

export type AllianceRecord = {
  score: number | null;
  teamKeys: string[];
  surrogateTeamKeys: string[];
  dqTeamKeys: string[];
};

export type MatchRecord = {
  matchKey: string;
  eventKey: string;
  compLevel: string;
  setNumber: number;
  matchNumber: number;
  redAlliance: AllianceRecord;
  blueAlliance: AllianceRecord;
  winningAlliance: string | null;
  eventTime: Date | null;
  predictedTime: Date | null;
  actualTime: Date | null;
  postResultTime: Date | null;
  scoreBreakdown: Record<string, unknown> | null;
  videos: Array<Record<string, unknown>>;
  syncedAt: Date;
};

export type TeamEventMetricRecord = {
  teamKey: string;
  eventKey: string;
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  opr: number | null;
  dpr: number | null;
  ccwm: number | null;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  source: SyncSource;
  sourcePayload: Record<string, unknown>;
  syncedAt: Date;
};

export type TeamYearMetricRecord = {
  teamKey: string;
  year: number;
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  source: SyncSource;
  sourcePayload: Record<string, unknown>;
  syncedAt: Date;
};

export type SeasonWindowRecord = {
  year: number;
  searchStartDate: string;
  searchEndDate: string;
  isActive: boolean;
};

export interface GlobalReferenceStore {
  getCursor(source: SyncSource, resource: string): Promise<SyncCursor | null>;
  saveCursor(cursor: SyncCursor): Promise<void>;
  listEventKeys(year: number): Promise<string[]>;
  upsertTeams(records: TeamRecord[]): Promise<void>;
  upsertEvents(records: EventRecord[]): Promise<void>;
  upsertMatches(records: MatchRecord[]): Promise<void>;
  upsertTeamEventMetrics(records: TeamEventMetricRecord[]): Promise<void>;
  upsertTeamYearMetrics(records: TeamYearMetricRecord[]): Promise<void>;
  upsertSeasonWindows(records: SeasonWindowRecord[]): Promise<void>;
}

export type JobDefinition<Input, Output> = {
  id: string;
  run(input: Input): Promise<Output>;
};

export type SyncSummary = {
  year: number;
  events: number;
  teams: number;
  matches: number;
  teamEventMetrics: number;
  teamYearMetrics: number;
  notModified: number;
};
