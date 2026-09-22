/**
 * Fill a local test database with a weekend of scouting.
 *
 * The Robots view is the first screen that reads `match_scout_entries` and
 * turns it into averages, spread, trend and a pick order — and there was no
 * way to look at it, because seeding a team and an event does not seed anybody
 * having scouted anything.
 *
 * Deliberately not random. Each robot is written to have a *character* the
 * screen should be able to name: a metronome, one that improves across the
 * day, one that is quick but keeps dying, one that never scores. If the view
 * cannot tell these apart, it is not doing its job, and randomness would hide
 * that behind noise.
 *
 * Refuses to run anywhere but a local throwaway database — this writes rows
 * that look like real scouting and must never reach a team's event.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("Set DATABASE_ADMIN_URL to the scratch database to seed.");
  process.exit(2);
}
const parsed = new URL(url);
const loopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
const scratchName = /(?:^|[_-])(test|ci|dev)(?:[_-]|$)/i.test(parsed.pathname.replace(/^\//, ""));
if (!loopback || !scratchName) {
  console.error(
    `Refusing to seed scouting into ${parsed.hostname}${parsed.pathname}. ` +
      "This writes rows that look like real scouting; point it at a local test database.",
  );
  process.exit(2);
}

const ORG_ID = "6925a000-0000-4000-8000-000000000001";

/** total points per match, in match order — each robot a different character. */
const ROBOTS = [
  { team: "frc254", note: "metronome, strong", series: [58, 61, 59, 60, 62, 59, 61, 60] },
  { team: "frc1114", note: "improves across the day", series: [24, 27, 26, 41, 44, 46, 48, 50] },
  { team: "frc118", note: "fast but keeps dying", series: [55, 0, 57, 0, 54, 56, 0, 58], dead: [1, 3, 6] },
  { team: "frc2056", note: "steady middle", series: [33, 31, 35, 32, 34, 33, 32, 35] },
  { team: "frc3310", note: "boom or bust", series: [8, 52, 6, 49, 11, 55, 4, 51] },
  { team: "frc6925", note: "climbs every match", series: [28, 30, 27, 31, 29, 30, 28, 32], climbs: true },
  { team: "frc971", note: "falls off after lunch", series: [47, 49, 48, 30, 28, 26, 29, 27] },
  { team: "frc1678", note: "plays defense", series: [12, 14, 11, 13, 12, 15, 13, 12], defense: true },
  { team: "frc604", note: "never scores", series: [0, 0, 0, 0, 0, 0, 0, 0] },
  { team: "frc9999", note: "only two matches watched", series: [40, 44] },
];

const client = new Client({ connectionString: url });
await client.connect();

try {
  await client.query("BEGIN");

  const event = await client.query(
    `SELECT event_key FROM match_scout_entries WHERE org_id=$1::uuid LIMIT 1`,
    [ORG_ID],
  );
  const eventKey =
    event.rows[0]?.event_key ??
    (await client.query(`SELECT event_key FROM events_ref ORDER BY event_key LIMIT 1`)).rows[0]
      ?.event_key;
  if (!eventKey) throw new Error("No event in events_ref — run scripts/seed-dev.mjs first.");

  const schema = await client.query(
    `SELECT id FROM scout_schemas WHERE org_id=$1::uuid ORDER BY created_at LIMIT 1`,
    [ORG_ID],
  );
  const schemaId = schema.rows[0]?.id;
  if (!schemaId) throw new Error("No scout schema for this org — run scripts/seed-dev.mjs first.");

  const scout = await client.query(
    `SELECT user_id FROM memberships WHERE org_id=$1::uuid ORDER BY created_at LIMIT 1`,
    [ORG_ID],
  );
  const scoutUserId = scout.rows[0]?.user_id;
  if (!scoutUserId) throw new Error("No member on this org — run scripts/seed-e2e-logins.mjs first.");

  const matchCount = Math.max(...ROBOTS.map((robot) => robot.series.length));
  const matchKeys = [];
  for (let index = 1; index <= matchCount; index += 1) {
    const matchKey = `${eventKey}_qm${index}`;
    // matches_ref is referenced by the entry, so the match has to exist.
    await client.query(
      `INSERT INTO matches_ref
         (match_key, event_key, comp_level, set_number, match_number, red_alliance, blue_alliance)
       VALUES ($1, $2, 'qm', 1, $3, '[]'::jsonb, '[]'::jsonb)
       ON CONFLICT (match_key) DO NOTHING`,
      [matchKey, eventKey, index],
    );
    matchKeys.push(matchKey);
  }

  // Every entry at this event, not just this script's own.
  //
  // Scoping the delete to `demo-scouting-%` left whatever `seed-dev.mjs` had
  // already written, so frc254 came back with eighteen matches — eight of them
  // this script's and ten with a different payload shape that evaluated to
  // zero. The robot written to be a metronome read as boom-or-bust, and the
  // screen was not wrong: that really was the data. A demo whose characters
  // are half somebody else's rows demonstrates nothing.
  await client.query(
    `DELETE FROM match_scout_entries WHERE org_id=$1::uuid AND event_key=$2`,
    [ORG_ID, eventKey],
  );

  let written = 0;
  for (const robot of ROBOTS) {
    await client.query(
      `INSERT INTO teams_ref (team_key, team_number, name, nickname)
       VALUES ($1, $2, $3, $3) ON CONFLICT (team_key) DO NOTHING`,
      [robot.team, Number(robot.team.replace("frc", "")), robot.note],
    );
    for (const [index, total] of robot.series.entries()) {
      const dead = (robot.dead ?? []).includes(index);
      const payload = {
        total_points: total,
        auto_points: dead ? 0 : Math.round(total * 0.25),
        teleop_points: dead ? 0 : Math.round(total * 0.6),
        endgame_points: dead ? 0 : Math.round(total * 0.15),
        disabled: dead,
        climbed: Boolean(robot.climbs) && !dead,
        defense: Boolean(robot.defense),
      };
      await client.query(
        `INSERT INTO match_scout_entries
           (org_id, event_key, match_key, team_key, scout_user_id, schema_id, payload, client_id)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7::jsonb, $8)
         ON CONFLICT DO NOTHING`,
        [
          ORG_ID,
          eventKey,
          matchKeys[index],
          robot.team,
          scoutUserId,
          schemaId,
          JSON.stringify(payload),
          `demo-scouting-${robot.team}-${index}`,
        ],
      );
      written += 1;
    }
  }

  // Without a value formula the view correctly refuses to guess what a field
  // is worth, so seeding one is part of seeding usable scouting.
  for (const [name, field] of [
    ["Total points", "total_points"],
    ["Auto", "auto_points"],
    ["Teleop", "teleop_points"],
    ["Endgame", "endgame_points"],
  ]) {
    await client.query(
      `INSERT INTO org_value_formulas (org_id, name, expression, created_by)
       VALUES ($1::uuid, $2, $3::jsonb, $4::uuid)
       ON CONFLICT (org_id, name) DO UPDATE SET expression = EXCLUDED.expression`,
      [ORG_ID, name, JSON.stringify({ op: "field", field }), scoutUserId],
    );
  }

  await client.query("COMMIT");
  console.log(`Seeded ${written} scouted matches for ${ROBOTS.length} robots at ${eventKey}.`);
  for (const robot of ROBOTS) console.log(`  ${robot.team.padEnd(9)} ${robot.note}`);
} catch (error) {
  await client.query("ROLLBACK");
  console.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
