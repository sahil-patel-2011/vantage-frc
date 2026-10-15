import { StatboticsClient } from "./statbotics-client";
import { isSyncedWithin, statboticsTtlMs } from "./cache-ttl";
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

/** Statbotics pages list endpoints; 1000 is its largest page. */
const STATBOTICS_PAGE = 1000;

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

  // Every team's season rating, paged: one unpaged request only ever returned Statbotics'
  // first page (1,000 of ~3,500 teams), so most teams had no season rating at all.
  const yearResource = `team_years?year=${year}`;
  const yearCursor = await options.store.getCursor("statbotics", yearResource);
  if (yearCursor && !yearCursor.lastError && isSyncedWithin(yearCursor.syncedAt, statboticsTtlMs(yearResource), now())) {
    summary.notModified += 1;
  } else {
    try {
      const pages: TeamYearMetricRecord[] = [];
      for (let page = 0, offset = 0; page < 10; page += 1) {
        const rows = requireArray(
          await options.statbotics.get<JsonObject[]>(`${yearResource}&limit=${STATBOTICS_PAGE}&offset=${offset}`),
          `Statbotics team years for ${year}`,
        );
        pages.push(...rows.map((value) => mapStatboticsYearMetric(value, year, now())));
        offset += rows.length;
        if (rows.length < STATBOTICS_PAGE) break;
      }
      await options.store.ensureTeams(pages.map((record) => ({
        teamKey: record.teamKey,
        teamNumber: Number(record.teamKey.replace(/^frc/, "")),
        nickname: null,
        name: `Team ${record.teamKey.replace(/^frc/, "")}`,
        city: null,
        stateProv: null,
        country: null,
        postalCode: null,
        rookieYear: null,
        website: null,
        syncedAt: now(),
      })));
      await options.store.upsertTeamYearMetrics(pages);
      summary.teamYearMetrics = pages.length;
      await options.store.saveCursor({
        source: "statbotics",
        resource: yearResource,
        etag: null,
        lastModified: null,
        cursor: yearCursor?.cursor ?? null,
        lastStatus: 200,
        lastError: null,
        syncedAt: now(),
        updatedAt: now(),
      });
    } catch (error) {
      await options.store.saveCursor(failedCursor("statbotics", yearResource, yearCursor, error, now()));
      throw error;
    }
  }
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

/**
 * Past seasons, ratings only: every team's Statbotics season rating for one year, paged, with a
 * compact stored record. This is what the prediction engine reads for up to ten seasons of
 * history (and the per-year field statistics it rescales with). Unlike a season sync it never
 * touches TBA, so loading ten years is ten small Statbotics reads, not tens of thousands of event
 * requests against the shared TBA limit.
 */
export async function syncTeamYearHistory(
  options: GlobalReferenceWorkerOptions,
  year: number,
): Promise<{ year: number; teams: number }> {
  if (!Number.isInteger(year) || year < 2002 || year > 2100) throw new Error("Choose a season from 2002 on.");
  const now = options.now ?? (() => new Date());
  let offset = 0;
  let teams = 0;
  // Ten pages is 10,000 teams, more than FRC has ever had in a season.
  for (let page = 0; page < 10; page += 1) {
    const resource = `team_years?year=${year}&limit=${STATBOTICS_PAGE}&offset=${offset}`;
    const rows = requireArray(await options.statbotics.get<JsonObject[]>(resource), `Statbotics team years for ${year}`);
    if (!rows.length) break;
    const records = rows
      .map((value) => compactYearMetric(value, year, now()))
      .filter((record) => record.teamKey && record.epaTotal != null);
    if (records.length) {
      // A season rating needs its team's directory row (foreign key): add the teams an event sync
      // never loaded (old seasons, teams that have since folded), without touching existing ones.
      await options.store.ensureTeams(records.map((record) => teamFromYearRow(rows, record.teamKey, now())));
      await options.store.upsertTeamYearMetrics(records);
    }
    teams += records.length;
    offset += rows.length;
    if (rows.length < STATBOTICS_PAGE) break;
  }
  await options.store.saveCursor({
    source: "statbotics",
    resource: `team_years_history?year=${year}`,
    etag: null,
    lastModified: null,
    cursor: null,
    lastStatus: 200,
    lastError: null,
    syncedAt: now(),
    updatedAt: now(),
  });
  return { year, teams };
}

/** The directory row a season rating needs, from what Statbotics' season list carries. */
function teamFromYearRow(rows: JsonObject[], teamKey: string, syncedAt: Date): TeamRecord {
  const teamNumber = Number(teamKey.replace(/^frc/, ""));
  const row = rows.find((value) => normalizeTeamKey(value.team) === teamKey) ?? {};
  const nickname = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
  return {
    teamKey,
    teamNumber,
    nickname,
    name: nickname ?? `Team ${teamNumber}`,
    city: null,
    stateProv: typeof row.state === "string" ? row.state : null,
    country: typeof row.country === "string" ? row.country : null,
    postalCode: null,
    rookieYear: numberOrNull(row.rookie_year),
    website: null,
    syncedAt,
  };
}

/** A season rating without the full Statbotics document: what history needs, a fraction of the size. */
function compactYearMetric(input: JsonObject, fallbackYear: number, syncedAt: Date): TeamYearMetricRecord {
  const full = mapStatboticsYearMetric(input, fallbackYear, syncedAt);
  const record = (input.record && typeof input.record === "object" ? input.record : {}) as JsonObject;
  const played = numberOrNull(record.count) ??
    ((numberOrNull(record.wins) ?? 0) + (numberOrNull(record.losses) ?? 0) + (numberOrNull(record.ties) ?? 0));
  return {
    ...full,
    sourcePayload: {
      team: input.team ?? null,
      year: full.year,
      matches: played || null,
      norm: numberAt(input, ["epa", "norm"]),
      history: true,
    },
  };
}

/** One published event-directory request; never download every event's matches. */
export async function syncGlobalEventDirectory(options: GlobalReferenceWorkerOptions, year: number): Promise<number | null> {
  if (!Number.isInteger(year) || year < 1992 || year > 2100) throw new Error("Choose a valid season year.");
  const now = options.now ?? (() => new Date());
  const result = await conditionalTba<JsonObject[]>(options, `events/${year}`, now);
  if (result.data === null) {
    await options.store.saveCursor({ ...result.cursor, cursor: null });
    return null;
  }
  const events = requireArray(result.data, "TBA events").map(value => mapEvent(value, now()));
  await options.store.upsertEvents(events);
  await options.store.saveCursor({ ...result.cursor, cursor: null });
  return events.length;
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
      includeEventRecord: Boolean(input.eventKeys?.length),
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
  opts: { includeStatbotics?: boolean; includeEventRecord?: boolean } = {},
): Promise<void> {
  const includeStatbotics = opts.includeStatbotics !== false;
  const encodedKey = encodeURIComponent(eventKey);

  if (opts.includeEventRecord) {
    const eventInfo = await conditionalTba<JsonObject>(options, `event/${encodedKey}`, now);
    if (eventInfo.data !== null) {
      await options.store.upsertEvents([mapEvent(eventInfo.data, now())]);
      summary.events += 1;
    } else {
      summary.notModified += 1;
    }
    await options.store.saveCursor(eventInfo.cursor);
  }
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
  const statPayload = await trackedStatbotics<JsonObject[]>(options, statResource, now);
  if (statPayload === null) {
    summary.notModified += 1;
    return;
  }
  const statEventRows = requireArray(statPayload, `Statbotics team events for ${eventKey}`).map(
    (value) => mapStatboticsEventMetric(value, eventKey, now()),
  );
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
): Promise<T | null> {
  const existing = await options.store.getCursor("statbotics", resource);
  const ttl = statboticsTtlMs(resource);
  if (existing && !existing.lastError && isSyncedWithin(existing.syncedAt, ttl, now())) {
    return null;
  }
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
