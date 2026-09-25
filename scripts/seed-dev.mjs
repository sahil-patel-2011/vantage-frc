#!/usr/bin/env node
/**
 * Seed a local development database with one team's plausible season.
 *
 * Why this exists: the unit suite proves the maths, and typecheck proves the
 * wiring, but neither ever renders a page. Until this script existed, the only
 * way to look at a populated screen was to point a dev server at production
 * data, which nobody should do to check a chevron. Now `npm run seed:dev`
 * produces an event, a schedule, ratings and scouting, and every product page
 * has something real to draw.
 *
 * Everything here is obviously synthetic — example.test addresses, a fixed
 * seed, round numbers — because seed data that looks real is seed data that
 * eventually gets mistaken for real. It never touches a remote database: the
 * connection string has to be localhost or the script refuses to run.
 *
 * Deterministic on purpose. Re-running gives byte-identical rows, so a
 * screenshot taken today can be compared with one taken next week.
 */

import { Client } from "pg";

const CONNECTION =
  process.env.SEED_DATABASE_URL ??
  process.env.DATABASE_ADMIN_URL ??
  "postgres://postgres:postgres@127.0.0.1:54331/vevents";

// A seed script writes with no RLS and no undo. Pointing one at a hosted
// database by accident is the kind of mistake that ends a season, so the
// hostname is checked rather than trusted.
const host = new URL(CONNECTION.replace(/^postgres(ql)?:/, "http:")).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`Refusing to seed a non-local database (host: ${host}).`);
  process.exit(1);
}

/** Fixed ids so re-running updates the same rows instead of piling up new ones. */
const ORG_ID = "6925a000-0000-4000-8000-000000000001";
const OWNER_ID = "6925a000-0000-4000-8000-000000000002";
const SCOUT_ID = "6925a000-0000-4000-8000-000000000003";
const SCHEMA_ID = "6925a000-0000-4000-8000-000000000004";

const OWNER_EMAIL = "owner@example.test";
const SCOUT_EMAIL = "scout@example.test";

const YEAR = 2026;
const EVENT_KEY = `${YEAR}gacmp`;
const EVENT_NAME = "Peachtree District Championship";
const OUR_TEAM = 6925;
/** Matches 1..N are played; the rest are still upcoming. */
const PLAYED_THROUGH = 30;
const TOTAL_MATCHES = 36;

/** A small deterministic generator, so every run produces identical data. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

const rnd = makeRandom(6925);

/** 24 teams: ours plus 23 others, with ratings spread over a realistic range. */
function buildTeams() {
  const numbers = [OUR_TEAM, 254, 1678, 118, 971, 2056, 33, 67, 1114, 148, 217, 195,
    1323, 2767, 3310, 1619, 2481, 4613, 6800, 5406, 3005, 7457, 8033, 9999];
  return numbers.map((number, index) => {
    // Descending skill with noise, so the field has a top, a middle and a tail
    // rather than 24 teams that all look the same.
    const base = 62 - index * 1.9 + (rnd() - 0.5) * 9;
    const epa = Math.max(8, Math.round(base * 10) / 10);
    return {
      teamKey: `frc${number}`,
      number,
      name: `Team ${number}`,
      nickname: `Team ${number}`,
      epa,
      auto: Math.round(epa * 0.17 * 10) / 10,
      teleop: Math.round(epa * 0.6 * 10) / 10,
      endgame: Math.round(epa * 0.23 * 10) / 10,
    };
  });
}

/** A qualification schedule where every team plays, and scores follow ratings. */
function buildMatches(teams) {
  const byKey = new Map(teams.map((t) => [t.teamKey, t]));
  const matches = [];
  for (let n = 1; n <= TOTAL_MATCHES; n += 1) {
    // Our team plays roughly every third match, and is in every upcoming one.
    // A random draw left 6925 out of the whole back half of the schedule, so
    // "next match", the match brief and the strategy screen all had nothing to
    // show — the exact screens this seed exists to make viewable.
    const ours = teams[0];
    const others = teams.slice(1).sort(() => rnd() - 0.5);
    const weArePlaying = n > PLAYED_THROUGH || n % 3 === 1;
    const roster = weArePlaying ? [ours, ...others.slice(0, 5)] : others.slice(0, 6);
    const shuffled = weArePlaying
      // Keep ours on an alliance but not always first, so the red/blue split is
      // not a fixed pattern anyone could read into.
      ? [...roster].sort(() => rnd() - 0.5)
      : roster;
    const red = shuffled.slice(0, 3).map((t) => t.teamKey);
    const blue = shuffled.slice(3, 6).map((t) => t.teamKey);
    const strength = (keys) =>
      keys.reduce((sum, k) => sum + (byKey.get(k)?.epa ?? 0), 0);
    // Score is the alliance's rating plus noise, so the better alliance usually
    // wins and sometimes does not — which is what a real schedule looks like,
    // and what makes the prediction calibration meaningful.
    const redScore = Math.max(0, Math.round(strength(red) + (rnd() - 0.5) * 40));
    const blueScore = Math.max(0, Math.round(strength(blue) + (rnd() - 0.5) * 40));
    // The last six are still to come. An event where everything has already
    // happened has no next match and nothing to predict, which is exactly the
    // half of the product most worth looking at.
    const played = n <= PLAYED_THROUGH;
    matches.push({
      matchKey: `${EVENT_KEY}_qm${n}`,
      number: n,
      red,
      blue,
      played,
      redScore: played ? redScore : null,
      blueScore: played ? blueScore : null,
      winner: !played ? null : redScore === blueScore ? null : redScore > blueScore ? "red" : "blue",
    });
  }
  return matches;
}

const MATCH_SCHEMA = {
  title: "Match scouting",
  fields: [
    { key: "autoPoints", label: "Auto points", type: "number", role: "auto_score" },
    { key: "teleopCycles", label: "Teleop cycles", type: "number", role: "teleop_cycles" },
    { key: "endgame", label: "Endgame", type: "dropdown", options: ["none", "park", "climb"] },
    { key: "totalPoints", label: "Total points", type: "number", role: "total_points" },
    { key: "fouls", label: "Fouls", type: "number", role: "fouls" },
    { key: "brokeDown", label: "Broke down", type: "dropdown", options: ["no", "yes"] },
    { key: "notes", label: "Notes", type: "long_text" },
  ],
};

/** Played matches sit in the recent past; upcoming ones in the near future. */
function playedAt(number) {
  return new Date(Date.now() - (PLAYED_THROUGH - number + 1) * 22 * 60_000).toISOString();
}

function upcomingAt(number) {
  return new Date(Date.now() + (number - PLAYED_THROUGH) * 22 * 60_000).toISOString();
}

async function main() {
  const db = new Client({ connectionString: CONNECTION });
  await db.connect();
  const teams = buildTeams();
  const matches = buildMatches(teams);

  await db.query("BEGIN");
  try {
    // ---- people -----------------------------------------------------------
    await db.query(
      `INSERT INTO users (id, email, name, email_verified)
       VALUES ($1::uuid, $2, 'Sahil Patel', true), ($3::uuid, $4, 'Riley Scout', true)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name`,
      [OWNER_ID, OWNER_EMAIL, SCOUT_ID, SCOUT_EMAIL],
    );

    // Onboarding is complete, otherwise proxy.ts sends every request to
    // /onboarding and no product page ever renders.
    for (const [id, first, last] of [
      [OWNER_ID, "Sahil", "Patel"],
      [SCOUT_ID, "Riley", "Scout"],
    ]) {
      await db.query(
        `INSERT INTO profiles (user_id, display_name, first_name, last_name,
           preferred_team_number, onboarding_completed_at, onboarding_current_step,
           terms_accepted_at, privacy_accepted_at)
         VALUES ($1::uuid, $2, $3, $4, $5, now(), 'complete', now(), now())
         ON CONFLICT (user_id) DO UPDATE SET
           onboarding_completed_at = now(),
           onboarding_current_step = 'complete',
           terms_accepted_at = now(),
           privacy_accepted_at = now()`,
        [id, `${first} ${last}`, first, last, OUR_TEAM],
      );
    }

    await db.query(
      `INSERT INTO organizations (id, name, slug, team_number)
       VALUES ($1::uuid, $2, 'team-6925', $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, team_number = EXCLUDED.team_number`,
      [ORG_ID, `Team ${OUR_TEAM}`, OUR_TEAM],
    );

    await db.query(
      `INSERT INTO memberships (org_id, user_id, role)
       VALUES ($1::uuid, $2::uuid, 'owner'), ($1::uuid, $3::uuid, 'scout')
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [ORG_ID, OWNER_ID, SCOUT_ID],
    );

    // ---- reference data ---------------------------------------------------
    await db.query(
      `INSERT INTO events_ref (event_key, year, name, start_date, end_date, city, state_prov, country, event_type)
       VALUES ($1, $2, $3, current_date - 1, current_date + 1, 'Macon', 'GA', 'USA', 2)
       -- The matches are placed around now, so the event's days are too: fixed March dates
       -- made a live event look over to everything that reads the end date.
       ON CONFLICT (event_key) DO UPDATE SET name = EXCLUDED.name,
         start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date`,
      [EVENT_KEY, YEAR, EVENT_NAME],
    );

    for (const t of teams) {
      await db.query(
        `INSERT INTO teams_ref (team_key, team_number, name, nickname, city, state_prov, country)
         VALUES ($1, $2, $3, $4, 'Macon', 'GA', 'USA')
         ON CONFLICT (team_key) DO UPDATE SET nickname = EXCLUDED.nickname`,
        [t.teamKey, t.number, t.name, t.nickname],
      );
    }

    for (const m of matches) {
      await db.query(
        `INSERT INTO matches_ref (match_key, event_key, comp_level, set_number, match_number,
           red_alliance, blue_alliance, winning_alliance, event_time, predicted_time, actual_time, synced_at)
         VALUES ($1, $2, 'qm', 1, $3, $4::jsonb, $5::jsonb, $6, $7::timestamptz, $7::timestamptz,
                 CASE WHEN $8::boolean THEN $7::timestamptz END, now())
         ON CONFLICT (match_key) DO UPDATE SET
           red_alliance = EXCLUDED.red_alliance,
           blue_alliance = EXCLUDED.blue_alliance,
           winning_alliance = EXCLUDED.winning_alliance,
           -- Without this the times from the first run survive every later
           -- one, so a reseed that moves a match into the future silently
           -- leaves it in the past. Idempotent has to mean every column.
           -- Like TBA: every match has its scheduled time; actual_time only once it is
           -- played. Upcoming matches with an actual_time counted as played everywhere.
           event_time = EXCLUDED.event_time,
           predicted_time = EXCLUDED.predicted_time,
           actual_time = EXCLUDED.actual_time,
           -- A reseed is a fresh sync; an old stamp made every screen say "may be out of date".
           synced_at = EXCLUDED.synced_at`,
        [
          m.matchKey,
          EVENT_KEY,
          m.number,
          JSON.stringify(
            m.played ? { teamKeys: m.red, score: m.redScore } : { teamKeys: m.red },
          ),
          JSON.stringify(
            m.played ? { teamKeys: m.blue, score: m.blueScore } : { teamKeys: m.blue },
          ),
          m.winner,
          m.played ? playedAt(m.number) : upcomingAt(m.number),
          m.played,
        ],
      );
    }

    // Ratings, so Strategy and the pick desk have something to rank. Played
    // counts come from the schedule rather than being invented separately, or
    // the two would disagree the moment anyone checked.
    const played = new Map(teams.map((t) => [t.teamKey, { w: 0, l: 0, t: 0, n: 0 }]));
    for (const m of matches.filter((x) => x.played)) {
      for (const key of m.red) {
        const row = played.get(key);
        if (!row) continue;
        row.n += 1;
        if (m.winner === "red") row.w += 1;
        else if (m.winner === "blue") row.l += 1;
        else row.t += 1;
      }
      for (const key of m.blue) {
        const row = played.get(key);
        if (!row) continue;
        row.n += 1;
        if (m.winner === "blue") row.w += 1;
        else if (m.winner === "red") row.l += 1;
        else row.t += 1;
      }
    }

    const ranked = [...teams].sort((a, b) => b.epa - a.epa);
    for (const [index, t] of ranked.entries()) {
      const rec = played.get(t.teamKey) ?? { w: 0, l: 0, t: 0, n: 0 };
      await db.query(
        `INSERT INTO team_event_metrics (team_key, event_key, epa_total, epa_auto, epa_teleop,
           epa_endgame, rank, wins, losses, ties, source, source_payload, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'statbotics', $11::jsonb, now())
         ON CONFLICT (team_key, event_key, source) DO UPDATE SET
           epa_total = EXCLUDED.epa_total, rank = EXCLUDED.rank,
           wins = EXCLUDED.wins, losses = EXCLUDED.losses, ties = EXCLUDED.ties,
           source_payload = EXCLUDED.source_payload, synced_at = now()`,
        [
          t.teamKey, EVENT_KEY, t.epa, t.auto, t.teleop, t.endgame,
          index + 1, rec.w, rec.l, rec.t,
          JSON.stringify({ matches: rec.n }),
        ],
      );
    }

    await db.query(
      `INSERT INTO org_active_context (org_id, active_event_key, set_by_user_id, set_at)
       VALUES ($1::uuid, $2, $3::uuid, now())
       ON CONFLICT (org_id) DO UPDATE SET active_event_key = EXCLUDED.active_event_key, set_at = now()`,
      [ORG_ID, EVENT_KEY, OWNER_ID],
    );

    // ---- scouting ---------------------------------------------------------
    await db.query(
      `INSERT INTO scout_schemas (id, org_id, year, type, version, schema, created_by)
       VALUES ($1::uuid, $2::uuid, $3, 'match', 1, $4::jsonb, $5::uuid)
       ON CONFLICT (id) DO UPDATE SET schema = EXCLUDED.schema`,
      [SCHEMA_ID, ORG_ID, YEAR, JSON.stringify(MATCH_SCHEMA), OWNER_ID],
    );

    let entries = 0;
    for (const m of matches.filter((x) => x.played).slice(0, 24)) {
      for (const teamKey of [...m.red, ...m.blue]) {
        const team = teams.find((t) => t.teamKey === teamKey);
        if (!team) continue;
        // Scouted numbers hover around the team's rating, so scouting agrees
        // with the ratings roughly and not exactly — which is the whole point
        // of having both.
        const total = Math.max(0, Math.round(team.epa + (rnd() - 0.5) * 18));
        const broke = rnd() < 0.07;
        await db.query(
          `INSERT INTO match_scout_entries (org_id, event_key, match_key, team_key,
             scout_user_id, schema_id, payload, confidence, source, client_id)
           VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7::jsonb, 'normal', 'manual', $8)
           ON CONFLICT (org_id, client_id) DO UPDATE SET payload = EXCLUDED.payload`,
          [
            ORG_ID, EVENT_KEY, m.matchKey, teamKey, SCOUT_ID, SCHEMA_ID,
            JSON.stringify({
              autoPoints: Math.round(total * 0.17),
              teleopCycles: Math.max(0, Math.round(total / 5)),
              endgame: rnd() < 0.55 ? "climb" : rnd() < 0.6 ? "park" : "none",
              totalPoints: broke ? Math.round(total * 0.2) : total,
              fouls: rnd() < 0.25 ? Math.round(rnd() * 6) : 0,
              brokeDown: broke ? "yes" : "no",
              notes: broke ? "Stopped moving mid-match." : "",
            }),
            `seed-${m.matchKey}-${teamKey}`,
          ],
        );
        entries += 1;
      }
    }

    await db.query("COMMIT");
    console.log("Seeded a local development season:");
    console.log(`  team          Team ${OUR_TEAM} (${ORG_ID})`);
    console.log(`  owner         ${OWNER_EMAIL}`);
    console.log(`  scout         ${SCOUT_EMAIL}`);
    console.log(`  event         ${EVENT_NAME} (${EVENT_KEY})`);
    console.log(`  teams         ${teams.length}`);
    console.log(`  matches       ${matches.filter((m) => m.played).length} played, ${matches.filter((m) => !m.played).length} upcoming`);
    console.log(`  scout entries ${entries}`);
  console.log(
    `  our matches   ${matches.filter((m) => [...m.red, ...m.blue].includes(`frc${OUR_TEAM}`)).length}` +
      ` (${matches.filter((m) => !m.played && [...m.red, ...m.blue].includes(`frc${OUR_TEAM}`)).length} upcoming)`,
  );
    console.log("\nSign in with the email code shown by scripts/dev-otp.mjs.");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
}

await main();
