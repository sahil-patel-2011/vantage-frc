import { assertOrgAuthentication, getUserEmailPreferences } from "@vantage/core";
import { countRoundTrips, withRlsOnPool } from "@vantage/db";
import { AgentRepository } from "@vantage/agent/repository";
import { getOrgPromptCachingEnabled } from "@vantage/agent";
import { IntelResearchRepository } from "@vantage/intel-research";
import { ScoutingRepository } from "@vantage/scouting/repository";
import type { PoolClient } from "@neondatabase/serverless";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { loadOrgConnectorSnapshot } from "../app/api/account/route";
import { loadCalendarPaint } from "../app/api/calendar/route";
import { loadMessagesHome } from "../app/api/messages/route";
import { loadMeProfile } from "../app/api/me/route";
import { loadSchedulePaint } from "../app/api/schedule/route";
import { loadTeamCalendarView } from "../app/api/team/calendar/route";
import { loadEventDayCommand } from "./command/load-command";
import { loadHomePaint } from "./dashboard/load-home";
import { requireDriveMembership } from "./drive/api";
import { listFiles, listFolders, loadDriveUsage, loadVirtualFolders } from "./drive/store";
import { currentBusinessSeason, loadBusinessView } from "./business-data";
import { computeHoursSelfViewView } from "./hours-self-view/compute-hours-self-view";
import { computeMatchSimView } from "./match-sim/compute-match-sim";
import { loadMyDayView } from "./my-day-load";
import { joinerNames } from "./notifications/joiner-names";
import { loadInboxPage } from "./notifications/inbox-store";
import { loadPitBoard } from "./pit/load-board";
import { computeRankingProjectionView } from "./ranking-projection/compute-ranking-projection";
import { resetDataSourceHealthMemo, loadDataSourceHealth } from "./reference-health";
import { loadBootstrapExtras } from "./scouting/bootstrap-extras";
import { resetSeasonScaleMemo } from "./strategy/season-scales";
import { computeStrategyView } from "./strategy/compute-strategy";
import { computeTodosView } from "./todos/compute-todos";
import { loadSkillAccessFacts } from "./ai-skills/server";
import { resolveTbaConfigured } from "./reference/tba-access";
import { LIVE_NOTIFICATION_SQL } from "./notifications/live-sql";

/**
 * Round trips for one paint of each main route, on the local fixture.
 * One batched wave is one trip. Production mode, with scheduled-event activation
 * already primed, so the count is the page and not the once-a-minute check.
 * Event day may use 8. Every other main route may use 6.
 */

const USER = "6925e2e0-0000-4000-8000-000000000001";
const ORG = "6925a000-0000-4000-8000-000000000001";
const FIXTURE_URL =
  process.env.ROUTE_BUDGET_DATABASE_URL ??
  "postgresql://vantage_app_login:vantage_dev@127.0.0.1:5432/vantage_ci?sslmode=disable";

const pool = new pg.Pool({ connectionString: FIXTURE_URL, max: 2 });
const routes: Array<{ route: string; budget: number; paint: (client: PoolClient) => Promise<unknown> }> = [];

function add(route: string, budget: number, paint: (client: PoolClient) => Promise<unknown>) {
  routes.push({ route, budget, paint });
}

add("/dashboard", 6, (client) => loadHomePaint(client, { orgId: ORG, userId: USER }));
add("/command", 8, (client) =>
  Promise.all([loadEventDayCommand(client, { orgId: ORG, userId: USER }), loadDataSourceHealth(client, ORG)]),
);
add("/strategy", 6, (client) =>
  Promise.all([
    computeStrategyView(client, { userId: USER, requestedOrg: ORG, readOnly: true }),
    loadDataSourceHealth(client, ORG),
  ]),
);
add("/my-day", 6, (client) => loadMyDayView(client, { userId: USER, requestedOrg: ORG }));
add("/pit", 6, (client) =>
  loadPitBoard(client, { orgId: ORG, userId: USER, member: { role: "owner", name: "Owner", teamNumber: 6925 } }),
);
add("/todos", 6, (client) =>
  computeTodosView(client, { userId: USER, requestedOrg: ORG, isolateReads: false }),
);
add("/match-sim", 6, (client) => computeMatchSimView(client, { userId: USER, requestedOrg: ORG }));
add("/ranking-projection", 6, (client) =>
  computeRankingProjectionView(client, { userId: USER, requestedOrg: ORG }),
);
add("/business", 6, (client) =>
  loadBusinessView(client, { userId: USER, requestedOrg: ORG, seasonYear: currentBusinessSeason() }),
);
add("/hours", 6, (client) => computeHoursSelfViewView(client, { userId: USER, requestedOrg: ORG }));
add("/notifications", 6, async (client) => {
  const page = await loadInboxPage(client, {
    userId: USER,
    orgId: ORG,
    active: false,
    filter: "all",
    limit: 40,
    cursor: null,
  });
  const joinerIds = page.rows
    .filter((row) => row.type === "invite_accepted" && typeof row.payload?.userId === "string")
    .map((row) => String(row.payload.userId));
  await joinerNames(client, [...new Set(joinerIds)]);
});
add("/messages", 6, (client) => loadMessagesHome(client, ORG, USER));
add("/calendar", 6, (client) => loadCalendarPaint(client, USER, ORG));
add("/schedule", 6, (client) => loadSchedulePaint(client, USER, ORG));
add("/team", 6, async (client) => {
  const membership = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [ORG, USER],
  );
  const role = membership.rows[0]?.role ?? "owner";
  return loadTeamCalendarView(client, ORG, USER, role);
});
add("/files", 6, async (client) => {
  const member = await requireDriveMembership(client, USER, ORG);
  await Promise.all([
    listFolders(client, { orgId: member.orgId, scope: "team", userId: USER, parentId: null }),
    listFiles(client, { orgId: member.orgId, scope: "team", userId: USER, role: member.role, folderId: null }),
    loadDriveUsage(client, { orgId: member.orgId, scope: "team", userId: USER }),
    loadVirtualFolders(client, { orgId: member.orgId }),
  ]);
});
add("/settings", 6, (client) => loadMeProfile(client, USER, ORG));
add("/workspace", 6, async (client) => {
  const authP = assertOrgAuthentication(client, {
    userId: USER,
    orgId: ORG,
    sessionId: "6925e2e0-0000-4000-8000-0000000000aa",
    authMethod: "email_otp",
  }).then(
    () => null,
    () => null,
  );
  await Promise.all([
    client.query(`SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2`, [ORG, USER]),
    authP,
    client.query(
      `SELECT c.active_event_key AS "eventKey", e.name AS "eventName"
       FROM org_active_context c LEFT JOIN events_ref e ON e.event_key = c.active_event_key
       WHERE c.org_id = $1`,
      [ORG],
    ),
    client.query(
      `SELECT m.match_key FROM org_active_context c
       JOIN matches_ref m ON m.event_key = c.active_event_key
       WHERE c.org_id = $1 AND COALESCE(m.actual_time, m.event_time, m.predicted_time) > now()
       LIMIT 2`,
      [ORG],
    ),
    client.query(
      `SELECT COALESCE(max(m.synced_at)::text, (SELECT synced_at::text FROM tba_cache_freshness LIMIT 1)) AS "syncedAt"
       FROM org_active_context c LEFT JOIN matches_ref m ON m.event_key = c.active_event_key
       WHERE c.org_id = $1`,
      [ORG],
    ),
    loadDataSourceHealth(client, ORG),
  ]);
});
add("/account", 6, async (client) => {
  const profileP = client.query(
    `SELECT display_name FROM profiles WHERE user_id=$1`,
    [USER],
  );
  const [profile] = await Promise.all([
    profileP,
    client.query(
      `SELECT count(*)::text AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL AND ${LIVE_NOTIFICATION_SQL}`,
      [USER],
    ),
    getUserEmailPreferences(client, USER),
    resolveTbaConfigured(client, null),
    client.query(
      `SELECT m.org_id AS "orgId" FROM memberships m WHERE m.user_id=$1::uuid
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at ASC LIMIT 1`,
      [USER],
    ),
  ]);
  void profile;
});
add("/intel", 6, async (client) => {
  const repository = new IntelResearchRepository(client);
  const authP = assertOrgAuthentication(client, {
    userId: USER,
    orgId: ORG,
    sessionId: "6925e2e0-0000-4000-8000-0000000000aa",
    authMethod: "email_otp",
  }).then(
    () => null,
    () => null,
  );
  const eventP = repository.getActiveEvent(ORG);
  await Promise.all([
    client.query(`SELECT role::text AS role FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid LIMIT 1`, [ORG, USER]),
    authP,
    eventP,
  ]);
  const active = await eventP;
  if (active?.eventKey) await repository.eventRoster(ORG, active.eventKey);
});
add("/scouting", 6, (client) => scoutPaint(client, false));
add("/competition", 6, (client) => scoutPaint(client, false));
add("/scout", 6, (client) => scoutPaint(client, true));
add("/build", 6, async (client) => {
  await client.query(
    `SELECT m.org_id AS "orgId" FROM memberships m JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid) LIMIT 1`,
    [USER, ORG],
  );
  await Promise.all([
    client.query(`SELECT id FROM game_scoring_actions WHERE org_id = $1 LIMIT 500`, [ORG]),
    client.query(`SELECT id FROM design_priorities WHERE org_id = $1 LIMIT 500`, [ORG]),
    client.query(`SELECT id FROM kickoff_rule_notes WHERE org_id = $1 LIMIT 500`, [ORG]),
    client.query(`SELECT id FROM next_season_signals WHERE org_id = $1 LIMIT 200`, [ORG]).catch(() => ({ rows: [] })),
  ]);
});
add("/ai", 6, async (client) => {
  const repository = new AgentRepository(client);
  await Promise.all([
    getOrgPromptCachingEnabled(client, ORG),
    loadSkillAccessFacts(client, ORG, USER),
    repository.listThreads(),
    repository.listUserMemories(USER),
    repository.getMemorySettings(USER, ORG),
  ]);
});

async function scoutPaint(client: PoolClient, withRoster: boolean) {
  const scouting = new ScoutingRepository(client);
  const intel = new IntelResearchRepository(client);
  const bootP = scouting.bootstrap(ORG, USER);
  const eventP = withRoster ? intel.getActiveEvent(ORG) : Promise.resolve(null);
  const authP = assertOrgAuthentication(client, {
    userId: USER,
    orgId: ORG,
    sessionId: "6925e2e0-0000-4000-8000-0000000000aa",
    authMethod: "email_otp",
  }).then(
    () => null,
    () => null,
  );
  const [boot, event] = await Promise.all([
    bootP,
    eventP,
    authP,
    client.query(`SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2`, [ORG, USER]),
  ]);
  await Promise.all([
    loadBootstrapExtras(client, { orgId: ORG, userId: USER, eventKey: boot.eventKey }),
    withRoster && event?.eventKey ? intel.eventRoster(ORG, event.eventKey) : Promise.resolve([]),
  ]);
}

let previousNodeEnv: string | undefined;

beforeAll(async () => {
  previousNodeEnv = process.env.NODE_ENV;
  try {
    const client = await pool.connect();
    client.release();
  } catch {
    throw new Error("fixture database is not reachable");
  }
  process.env.NODE_ENV = "production";
  await withRlsOnPool(pool as never, { userId: USER, orgId: ORG }, async () => undefined);
  await withRlsOnPool(pool as never, { userId: USER }, async () => undefined);
});

afterAll(async () => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  await pool.end();
});

it("keeps each main route inside its database round-trip budget", async () => {
  const misses: string[] = [];
  for (const entry of routes) {
    resetDataSourceHealthMemo();
    resetSeasonScaleMemo();
    try {
      const counted = await countRoundTrips(() =>
        withRlsOnPool(pool as never, { userId: USER, orgId: entry.route === "/account" ? undefined : ORG }, entry.paint),
      );
      let trips = counted.roundTrips;
      if (trips > entry.budget) {
        misses.push(`${entry.route} used ${trips} round trips (budget ${entry.budget})\n${counted.scripts.map((script, index) => `  ${index + 1}. ${script}`).join("\n")}`);
        continue;
      }
      if (entry.route === "/account") {
        const connectors = await countRoundTrips(() =>
          withRlsOnPool(pool as never, { userId: USER, orgId: ORG }, (client) =>
            loadOrgConnectorSnapshot(client, ORG, USER),
          ),
        );
        trips += connectors.roundTrips;
        if (trips > entry.budget) {
          misses.push(`${entry.route} used ${trips} round trips (budget ${entry.budget})\n${connectors.scripts.map((script, index) => `  c${index + 1}. ${script}`).join("\n")}`);
          continue;
        }
      }
    } catch (error) {
      misses.push(`${entry.route} threw ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  expect(misses).toEqual([]);
});
