import { dbAdmin } from "@vantage/db/admin";
import {
  eventsRef,
  matchesRef,
  seasonWindows,
  syncCursors,
  teamEventMetrics,
  teamsRef,
  teamYearMetrics,
} from "@vantage/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type {
  EventRecord,
  GlobalReferenceStore,
  MatchRecord,
  SeasonWindowRecord,
  SyncCursor,
  SyncSource,
  TeamEventMetricRecord,
  TeamRecord,
  TeamYearMetricRecord,
} from "./types";

const writeChunks = async <T>(
  records: T[],
  write: (chunk: T[]) => Promise<unknown>,
) => {
  for (let offset = 0; offset < records.length; offset += 250) {
    await write(records.slice(offset, offset + 250));
  }
};

export class AdminGlobalReferenceStore implements GlobalReferenceStore {
  async getCursor(
    source: SyncSource,
    resource: string,
  ): Promise<SyncCursor | null> {
    const [row] = await dbAdmin
      .select()
      .from(syncCursors)
      .where(
        and(eq(syncCursors.source, source), eq(syncCursors.resource, resource)),
      )
      .limit(1);
    return row ? { ...row, source: row.source as SyncSource } : null;
  }

  async saveCursor(cursor: SyncCursor): Promise<void> {
    await dbAdmin
      .insert(syncCursors)
      .values(cursor)
      .onConflictDoUpdate({
        target: [syncCursors.source, syncCursors.resource],
        set: {
          etag: cursor.etag,
          lastModified: cursor.lastModified,
          cursor: cursor.cursor,
          lastStatus: cursor.lastStatus,
          lastError: cursor.lastError,
          syncedAt: cursor.syncedAt,
          updatedAt: cursor.updatedAt,
        },
      });
  }

  async listEventKeys(year: number): Promise<string[]> {
    const rows = await dbAdmin
      .select({ eventKey: eventsRef.eventKey })
      .from(eventsRef)
      .where(eq(eventsRef.year, year));
    return rows.map((row) => row.eventKey);
  }

  async upsertTeams(records: TeamRecord[]): Promise<void> {
    await writeChunks(records, (chunk) =>
      dbAdmin
        .insert(teamsRef)
        .values(chunk)
        .onConflictDoUpdate({
          target: teamsRef.teamKey,
          set: {
            teamNumber: sql`excluded.team_number`,
            nickname: sql`excluded.nickname`,
            name: sql`excluded.name`,
            city: sql`excluded.city`,
            stateProv: sql`excluded.state_prov`,
            country: sql`excluded.country`,
            postalCode: sql`excluded.postal_code`,
            rookieYear: sql`excluded.rookie_year`,
            website: sql`excluded.website`,
            syncedAt: sql`excluded.synced_at`,
          },
        }),
    );
  }

  async upsertEvents(records: EventRecord[]): Promise<void> {
    await writeChunks(records, (chunk) =>
      dbAdmin
        .insert(eventsRef)
        .values(chunk)
        .onConflictDoUpdate({
          target: eventsRef.eventKey,
          set: {
            year: sql`excluded.year`,
            name: sql`excluded.name`,
            shortName: sql`excluded.short_name`,
            startDate: sql`excluded.start_date`,
            endDate: sql`excluded.end_date`,
            eventType: sql`excluded.event_type`,
            week: sql`excluded.week`,
            districtKey: sql`excluded.district_key`,
            city: sql`excluded.city`,
            stateProv: sql`excluded.state_prov`,
            country: sql`excluded.country`,
            address: sql`excluded.address`,
            postalCode: sql`excluded.postal_code`,
            timezone: sql`excluded.timezone`,
            website: sql`excluded.website`,
            parentEventKey: sql`excluded.parent_event_key`,
            webcasts: sql`excluded.webcasts`,
            syncedAt: sql`excluded.synced_at`,
          },
        }),
    );
  }

  async upsertMatches(records: MatchRecord[]): Promise<void> {
    await writeChunks(records, (chunk) =>
      dbAdmin
        .insert(matchesRef)
        .values(chunk)
        .onConflictDoUpdate({
          target: matchesRef.matchKey,
          set: {
            eventKey: sql`excluded.event_key`,
            compLevel: sql`excluded.comp_level`,
            setNumber: sql`excluded.set_number`,
            matchNumber: sql`excluded.match_number`,
            redAlliance: sql`excluded.red_alliance`,
            blueAlliance: sql`excluded.blue_alliance`,
            winningAlliance: sql`excluded.winning_alliance`,
            eventTime: sql`excluded.event_time`,
            predictedTime: sql`excluded.predicted_time`,
            actualTime: sql`excluded.actual_time`,
            postResultTime: sql`excluded.post_result_time`,
            scoreBreakdown: sql`excluded.score_breakdown`,
            videos: sql`excluded.videos`,
            syncedAt: sql`excluded.synced_at`,
          },
        }),
    );
  }

  async upsertTeamEventMetrics(
    records: TeamEventMetricRecord[],
  ): Promise<void> {
    await writeChunks(records, (chunk) =>
      dbAdmin
        .insert(teamEventMetrics)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            teamEventMetrics.teamKey,
            teamEventMetrics.eventKey,
            teamEventMetrics.source,
          ],
          set: {
            epaTotal: sql`COALESCE(excluded.epa_total, ${teamEventMetrics.epaTotal})`,
            epaAuto: sql`COALESCE(excluded.epa_auto, ${teamEventMetrics.epaAuto})`,
            epaTeleop: sql`COALESCE(excluded.epa_teleop, ${teamEventMetrics.epaTeleop})`,
            epaEndgame: sql`COALESCE(excluded.epa_endgame, ${teamEventMetrics.epaEndgame})`,
            opr: sql`COALESCE(excluded.opr, ${teamEventMetrics.opr})`,
            dpr: sql`COALESCE(excluded.dpr, ${teamEventMetrics.dpr})`,
            ccwm: sql`COALESCE(excluded.ccwm, ${teamEventMetrics.ccwm})`,
            rank: sql`COALESCE(excluded.rank, ${teamEventMetrics.rank})`,
            wins: sql`COALESCE(excluded.wins, ${teamEventMetrics.wins})`,
            losses: sql`COALESCE(excluded.losses, ${teamEventMetrics.losses})`,
            ties: sql`COALESCE(excluded.ties, ${teamEventMetrics.ties})`,
            sourcePayload: sql`${teamEventMetrics.sourcePayload} || excluded.source_payload`,
            syncedAt: sql`excluded.synced_at`,
          },
        }),
    );
  }

  async upsertTeamYearMetrics(records: TeamYearMetricRecord[]): Promise<void> {
    await writeChunks(records, (chunk) =>
      dbAdmin
        .insert(teamYearMetrics)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            teamYearMetrics.teamKey,
            teamYearMetrics.year,
            teamYearMetrics.source,
          ],
          set: {
            epaTotal: sql`excluded.epa_total`,
            epaAuto: sql`excluded.epa_auto`,
            epaTeleop: sql`excluded.epa_teleop`,
            epaEndgame: sql`excluded.epa_endgame`,
            sourcePayload: sql`excluded.source_payload`,
            syncedAt: sql`excluded.synced_at`,
          },
        }),
    );
  }

  async upsertSeasonWindows(records: SeasonWindowRecord[]): Promise<void> {
    await writeChunks(records, (chunk) =>
      dbAdmin
        .insert(seasonWindows)
        .values(chunk)
        .onConflictDoUpdate({
          target: seasonWindows.year,
          set: {
            searchStartDate: sql`excluded.search_start_date`,
            searchEndDate: sql`excluded.search_end_date`,
            isActive: sql`excluded.is_active`,
          },
        }),
    );
  }
}

export const globalReferenceAdminStore = new AdminGlobalReferenceStore();
