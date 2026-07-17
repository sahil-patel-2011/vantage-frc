import { StatboticsClient } from "./statbotics-client";
import { TbaClient, type TbaResponse } from "./tba-client";
import type {
  AllianceRecord,
  EventDaySyncInput,
  EventRecord,
  GlobalReferenceStore,
  JobDefinition,
  MatchRecord,
  SeasonWindowRecord,
  SyncCursor,
  SyncSource,
  SyncSummary,
  TeamEventMetricRecord,
  TeamRecord,
  TeamYearMetricRecord,
} from "./types";

type JsonObject = Record<string, unknown>;

/** Minimal TBA surface used by the worker (TbaClient or GlobalTbaCoordinator). */
export type TbaGetter = {
  get<T>(
    resource: string,
    options?: { etag?: string | null; lastModified?: string | null },
  ): Promise<TbaResponse<T>>;
};

export type GlobalReferenceWorkerOptions = {
  store: GlobalReferenceStore;
  tba: TbaGetter;
  statbotics: StatboticsClient;
  now?: () => Date;
};

export type GlobalReferenceJobInput = { year: number };

export function createGlobalReferenceJobs(
  options: GlobalReferenceWorkerOptions,
): {
  syncSeason: JobDefinition<GlobalReferenceJobInput, SyncSummary>;
  syncEventDay: JobDefinition<EventDaySyncInput, SyncSummary>;
} {
  return {
    syncSeason: {
      id: "reference.sync-season",
      run: ({ year }) => syncGlobalReferenceSeason(options, year),
    },
    syncEventDay: {
      id: "reference.sync-event-day",
      run: (input) => syncActiveEventDay(options, input),
    },
  };
}

export async function syncGlobalReferenceSeason(
  options: GlobalReferenceWorkerOptions,
  year: number,
): Promise<SyncSummary> {
  if (!Number.isInteger(year) || year < 1992 || year > 2100) {
    throw new Error(`Invalid FRC season year: ${year}`);
  }

  const now = options.now ?? (() => new Date());
  const summary = emptySummary(year, "season");

  await options.store.upsertSeasonWindows([seasonWindow(year, now())]);
  const eventResource = `events/${year}`;
  const eventsResult = await conditionalTba<JsonObject[]>(
    options,
    eventResource,
    now,
  );
  let eventKeys: string[];
  if (eventsResult.data === null) {
    summary.notModified += 1;
    eventKeys = await options.store.listEventKeys(year);
  } else {
    const events = requireArray(eventsResult.data, "TBA events").map((value) =>
      mapEvent(value, now()),
    );
    await options.store.upsertEvents(events);
    summary.events += events.length;
    eventKeys = events.map((event) => event.eventKey);
  }
  // Progress cursor: last completed event key for mid-run resume visibility.
  await options.store.saveCursor({
    ...eventsResult.cursor,
    cursor: null,
  });

  for (const eventKey of eventKeys) {
    await syncEventBundle(options, eventKey, summary, now);
    await options.store.saveCursor({
      source: "tba",
      resource: eventResource,
      etag: eventsResult.cursor.etag,
      lastModified: eventsResult.cursor.lastModified,
      cursor: eventKey,
      lastStatus: eventsResult.cursor.lastStatus,
      lastError: null,
      syncedAt: now(),
      updatedAt: now(),
    });
  }

  const yearResource = `team_years?year=${year}`;
  const yearRows = requireArray(
    await trackedStatbotics<JsonObject[]>(options, yearResource, now),
    `Statbotics team years for ${year}`,
  ).map((value) => mapStatboticsYearMetric(value, year, now()));
  await options.store.upsertTeamYearMetrics(yearRows);
  summary.teamYearMetrics = yearRows.length;
  summary.eventKeys = eventKeys;

  // Clear progress token after a full successful season pass.
  await options.store.saveCursor({
    ...eventsResult.cursor,
    cursor: null,
    syncedAt: now(),
    updatedAt: now(),
  });

  return summary;
}

export async function syncActiveEventDay(
  options: GlobalReferenceWorkerOptions,
  input: EventDaySyncInput = {},
): Promise<SyncSummary> {
  const now = options.now ?? (() => new Date());
  const at = now();
  const year =
    input.year ??
    (at.getUTCMonth() >= 9 ? at.getUTCFullYear() + 1 : at.getUTCFullYear());
  const withinDays =
    input.withinDays === undefined ? 1 : Math.max(0, input.withinDays);

  const summary = emptySummary(year, "event-day");
  await options.store.upsertSeasonWindows([seasonWindow(year, at)]);

  let eventKeys =
    input.eventKeys && input.eventKeys.length > 0
      ? [...new Set(input.eventKeys)]
      : await options.store.listActiveEventKeys({ at, withinDays, year });

  // If the cache has no dated events yet, refresh the season event list once.
  if (eventKeys.length === 0 && (!input.eventKeys || input.eventKeys.length === 0)) {
    const eventResource = `events/${year}`;
    const eventsResult = await conditionalTba<JsonObject[]>(
      options,
      eventResource,
      now,
    );
    if (eventsResult.data !== null) {
      const events = requireArray(eventsResult.data, "TBA events").map((value) =>
        mapEvent(value, now()),
      );
      await options.store.upsertEvents(events);
      summary.events += events.length;
    } else {
      summary.notModified += 1;
    }
    await options.store.saveCursor(eventsResult.cursor);
    eventKeys = await options.store.listActiveEventKeys({
      at,
      withinDays,
      year,
    });
  }

  for (const eventKey of eventKeys) {
    await syncEventBundle(options, eventKey, summary, now, {
      includeStatbotics: true,
    });
  }

  summary.eventKeys = eventKeys;
  return summary;
}

async function syncEventBundle(
  options: GlobalReferenceWorkerOptions,
  eventKey: string,
  summary: SyncSummary,
  now: () => Date,
  opts: { includeStatbotics?: boolean } = {},
): Promise<void> {
  const includeStatbotics = opts.includeStatbotics !== false;
  const encodedKey = encodeURIComponent(eventKey);
  const [teams, matches, oprs, rankings] = await Promise.all([
    conditionalTba<JsonObject[]>(options, `event/${encodedKey}/teams`, now),
    conditionalTba<JsonObject[]>(options, `event/${encodedKey}/matches`, now),
    conditionalTba<JsonObject>(options, `event/${encodedKey}/oprs`, now),
    conditionalTba<JsonObject>(options, `event/${encodedKey}/rankings`, now),
  ]);

  if (teams.data === null) summary.notModified += 1;
  else {
    const records = requireArray(teams.data, `TBA teams for ${eventKey}`).map(
      (value) => mapTeam(value, now()),
    );
    await options.store.upsertTeams(records);
    summary.teams += records.length;
  }
  await options.store.saveCursor(teams.cursor);

  if (matches.data === null) summary.notModified += 1;
  else {
    const records = requireArray(
      matches.data,
      `TBA matches for ${eventKey}`,
    ).map((value) => mapMatch(value, now()));
    await options.store.upsertMatches(records);
    summary.matches += records.length;
  }
  await options.store.saveCursor(matches.cursor);

  if (oprs.data === null) summary.notModified += 1;
  if (rankings.data === null) summary.notModified += 1;
  if (oprs.data !== null || rankings.data !== null) {
    const records = mapTbaMetrics(eventKey, oprs.data, rankings.data, now());
    await options.store.upsertTeamEventMetrics(records);
    summary.teamEventMetrics += records.length;
  }
  await Promise.all([
    options.store.saveCursor(oprs.cursor),
    options.store.saveCursor(rankings.cursor),
  ]);

  if (!includeStatbotics) return;

  const statResource = `team_events?event=${encodeURIComponent(eventKey)}`;
  const statEventRows = requireArray(
    await trackedStatbotics<JsonObject[]>(options, statResource, now),
    `Statbotics team events for ${eventKey}`,
  ).map((value) => mapStatboticsEventMetric(value, eventKey, now()));
  await options.store.upsertTeamEventMetrics(statEventRows);
  summary.teamEventMetrics += statEventRows.length;
}

function emptySummary(year: number, mode: SyncSummary["mode"]): SyncSummary {
  return {
    year,
    mode,
    eventKeys: [],
    events: 0,
    teams: 0,
    matches: 0,
    teamEventMetrics: 0,
    teamYearMetrics: 0,
    notModified: 0,
  };
}

async function conditionalTba<T>(
  options: GlobalReferenceWorkerOptions,
  resource: string,
  now: () => Date,
): Promise<{ data: T | null; cursor: SyncCursor }> {
  const existing = await options.store.getCursor("tba", resource);
  try {
    const response = await options.tba.get<T>(resource, {
      etag: existing?.etag,
      lastModified: existing?.lastModified,
    });
    return {
      data: response.data,
      cursor: cursorFromTba(resource, existing, response, now()),
    };
  } catch (error) {
    await options.store.saveCursor(
      failedCursor("tba", resource, existing, error, now()),
    );
    throw error;
  }
}

async function trackedStatbotics<T>(
  options: GlobalReferenceWorkerOptions,
  resource: string,
  now: () => Date,
): Promise<T> {
  const existing = await options.store.getCursor("statbotics", resource);
  try {
    const data = await options.statbotics.get<T>(resource);
    await options.store.saveCursor({
      source: "statbotics",
      resource,
      etag: null,
      lastModified: null,
      cursor: existing?.cursor ?? null,
      lastStatus: 200,
      lastError: null,
      syncedAt: now(),
      updatedAt: now(),
    });
    return data;
  } catch (error) {
    await options.store.saveCursor(
      failedCursor("statbotics", resource, existing, error, now()),
    );
    throw error;
  }
}

function cursorFromTba(
  resource: string,
  existing: SyncCursor | null,
  response: TbaResponse<unknown>,
  at: Date,
): SyncCursor {
  return {
    source: "tba",
    resource,
    etag: response.etag ?? existing?.etag ?? null,
    lastModified: response.lastModified ?? existing?.lastModified ?? null,
    cursor: existing?.cursor ?? null,
    lastStatus: response.status,
    lastError: null,
    syncedAt: at,
    updatedAt: at,
  };
}

function failedCursor(
  source: SyncSource,
  resource: string,
  existing: SyncCursor | null,
  error: unknown,
  at: Date,
): SyncCursor {
  return {
    source,
    resource,
    etag: existing?.etag ?? null,
    lastModified: existing?.lastModified ?? null,
    cursor: existing?.cursor ?? null,
    lastStatus:
      typeof error === "object" && error !== null && "status" in error
        ? numberOrNull((error as { status: unknown }).status)
        : null,
    lastError:
      error instanceof Error
        ? error.message.slice(0, 2_000)
        : "Unknown ingest error",
    syncedAt: existing?.syncedAt ?? null,
    updatedAt: at,
  };
}

function mapTeam(input: JsonObject, syncedAt: Date): TeamRecord {
  return {
    teamKey: requiredString(input.key, "team.key"),
    teamNumber: requiredNumber(input.team_number, "team.team_number"),
    nickname: stringOrNull(input.nickname),
    name: requiredString(input.name, "team.name"),
    city: stringOrNull(input.city),
    stateProv: stringOrNull(input.state_prov),
    country: stringOrNull(input.country),
    postalCode: stringOrNull(input.postal_code),
    rookieYear: numberOrNull(input.rookie_year),
    website: stringOrNull(input.website),
    syncedAt,
  };
}

function mapEvent(input: JsonObject, syncedAt: Date): EventRecord {
  return {
    eventKey: requiredString(input.key, "event.key"),
    year: requiredNumber(input.year, "event.year"),
    name: requiredString(input.name, "event.name"),
    shortName: stringOrNull(input.short_name),
    startDate: stringOrNull(input.start_date),
    endDate: stringOrNull(input.end_date),
    eventType: numberOrNull(input.event_type),
    week: numberOrNull(input.week),
    districtKey: stringOrNull(asObject(input.district)?.key),
    city: stringOrNull(input.city),
    stateProv: stringOrNull(input.state_prov),
    country: stringOrNull(input.country),
    address: stringOrNull(input.address),
    postalCode: stringOrNull(input.postal_code),
    timezone: stringOrNull(input.timezone),
    website: stringOrNull(input.website),
    parentEventKey: stringOrNull(input.parent_event_key),
    webcasts: objectArray(input.webcasts),
    syncedAt,
  };
}

function mapMatch(input: JsonObject, syncedAt: Date): MatchRecord {
  const alliances = requiredObject(input.alliances, "match.alliances");
  return {
    matchKey: requiredString(input.key, "match.key"),
    eventKey: requiredString(input.event_key, "match.event_key"),
    compLevel: requiredString(input.comp_level, "match.comp_level"),
    setNumber: requiredNumber(input.set_number, "match.set_number"),
    matchNumber: requiredNumber(input.match_number, "match.match_number"),
    redAlliance: mapAlliance(
      requiredObject(alliances.red, "match.alliances.red"),
    ),
    blueAlliance: mapAlliance(
      requiredObject(alliances.blue, "match.alliances.blue"),
    ),
    winningAlliance: stringOrNull(input.winning_alliance),
    eventTime: unixDate(input.time),
    predictedTime: unixDate(input.predicted_time),
    actualTime: unixDate(input.actual_time),
    postResultTime: unixDate(input.post_result_time),
    scoreBreakdown: asObject(input.score_breakdown),
    videos: objectArray(input.videos),
    syncedAt,
  };
}

function mapAlliance(input: JsonObject): AllianceRecord {
  return {
    score: numberOrNull(input.score),
    teamKeys: stringArray(input.team_keys),
    surrogateTeamKeys: stringArray(input.surrogate_team_keys),
    dqTeamKeys: stringArray(input.dq_team_keys),
  };
}

function mapTbaMetrics(
  eventKey: string,
  oprPayload: JsonObject | null,
  rankingPayload: JsonObject | null,
  syncedAt: Date,
): TeamEventMetricRecord[] {
  const oprs = asObject(oprPayload?.oprs) ?? {};
  const dprs = asObject(oprPayload?.dprs) ?? {};
  const ccwms = asObject(oprPayload?.ccwms) ?? {};
  const rankings = Array.isArray(rankingPayload?.rankings)
    ? rankingPayload.rankings
    : [];
  const rankingByTeam = new Map<string, JsonObject>();
  for (const row of rankings) {
    const object = asObject(row);
    if (object && typeof object.team_key === "string")
      rankingByTeam.set(object.team_key, object);
  }
  const teamKeys = new Set([
    ...Object.keys(oprs),
    ...Object.keys(dprs),
    ...Object.keys(ccwms),
    ...rankingByTeam.keys(),
  ]);
  return [...teamKeys].map((teamKey) => {
    const ranking = rankingByTeam.get(teamKey);
    const record = asObject(ranking?.record);
    return {
      teamKey,
      eventKey,
      epaTotal: null,
      epaAuto: null,
      epaTeleop: null,
      epaEndgame: null,
      opr: numberOrNull(oprs[teamKey]),
      dpr: numberOrNull(dprs[teamKey]),
      ccwm: numberOrNull(ccwms[teamKey]),
      rank: numberOrNull(ranking?.rank),
      wins: numberOrNull(record?.wins),
      losses: numberOrNull(record?.losses),
      ties: numberOrNull(record?.ties),
      source: "tba",
      sourcePayload: {
        ...(oprPayload
          ? {
              opr: oprs[teamKey] ?? null,
              dpr: dprs[teamKey] ?? null,
              ccwm: ccwms[teamKey] ?? null,
            }
          : {}),
        ...(ranking ? { ranking } : {}),
      },
      syncedAt,
    };
  });
}

function mapStatboticsEventMetric(
  input: JsonObject,
  fallbackEventKey: string,
  syncedAt: Date,
): TeamEventMetricRecord {
  const record = asObject(input.record);
  const totalRecord = asObject(record?.total) ?? record;
  return {
    teamKey: normalizeTeamKey(input.team),
    eventKey: stringOrNull(input.event) ?? fallbackEventKey,
    ...epaFields(input),
    opr: numberAt(input, ["opr"]),
    dpr: numberAt(input, ["dpr"]),
    ccwm: numberAt(input, ["ccwm"]),
    rank:
      numberAt(input, ["record", "qual", "rank"]) ?? numberAt(input, ["rank"]),
    wins: numberOrNull(totalRecord?.wins),
    losses: numberOrNull(totalRecord?.losses),
    ties: numberOrNull(totalRecord?.ties),
    source: "statbotics",
    sourcePayload: input,
    syncedAt,
  };
}

function mapStatboticsYearMetric(
  input: JsonObject,
  fallbackYear: number,
  syncedAt: Date,
): TeamYearMetricRecord {
  return {
    teamKey: normalizeTeamKey(input.team),
    year: numberOrNull(input.year) ?? fallbackYear,
    ...epaFields(input),
    source: "statbotics",
    sourcePayload: input,
    syncedAt,
  };
}

function epaFields(input: JsonObject) {
  return {
    epaTotal:
      numberAt(input, ["epa", "total_points", "mean"]) ??
      numberAt(input, ["epa", "total_points"]) ??
      numberAt(input, ["epa"]),
    epaAuto:
      numberAt(input, ["epa", "breakdown", "auto_points"]) ??
      numberAt(input, ["epa", "auto_points", "mean"]),
    epaTeleop:
      numberAt(input, ["epa", "breakdown", "teleop_points"]) ??
      numberAt(input, ["epa", "teleop_points", "mean"]),
    epaEndgame:
      numberAt(input, ["epa", "breakdown", "endgame_points"]) ??
      numberAt(input, ["epa", "endgame_points", "mean"]),
  };
}

function seasonWindow(year: number, now: Date): SeasonWindowRecord {
  const kickoff = new Date(Date.UTC(year, 0, 1));
  kickoff.setUTCDate(
    kickoff.getUTCDate() + ((6 - kickoff.getUTCDay() + 7) % 7),
  );
  const end = new Date(Date.UTC(year, 3, 30));
  return {
    year,
    searchStartDate: kickoff.toISOString().slice(0, 10),
    searchEndDate: end.toISOString().slice(0, 10),
    isActive:
      now >= kickoff && now <= new Date(Date.UTC(year, 3, 30, 23, 59, 59, 999)),
  };
}

function requireArray(value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value))
    throw new Error(`${label} response must be an array`);
  return value.map((entry, index) =>
    requiredObject(entry, `${label}[${index}]`),
  );
}

function requiredObject(value: unknown, label: string): JsonObject {
  const object = asObject(value);
  if (!object) throw new Error(`${label} must be an object`);
  return object;
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value)
    throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  const number = numberOrNull(value);
  if (number === null) throw new Error(`${label} must be a finite number`);
  return number;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(asObject).filter((item): item is JsonObject => item !== null)
    : [];
}

function unixDate(value: unknown): Date | null {
  const seconds = numberOrNull(value);
  return seconds === null ? null : new Date(seconds * 1_000);
}

function normalizeTeamKey(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value) && value > 0)
    return `frc${value}`;
  const text = requiredString(value, "metric.team");
  return text.startsWith("frc") ? text : `frc${text}`;
}

function numberAt(input: JsonObject, path: string[]): number | null {
  let current: unknown = input;
  for (const segment of path) {
    const object = asObject(current);
    if (!object) return null;
    current = object[segment];
  }
  return numberOrNull(current);
}

// Keep TbaClient import used by unit tests that construct workers with TbaClient.
export type { TbaClient };
