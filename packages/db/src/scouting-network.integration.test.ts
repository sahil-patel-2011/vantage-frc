import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const url = process.env.TEST_SCOUTING_DATABASE_URL;
const db = url ? describe : describe.skip;
db("scouting network database boundary", () => {
  it("shares only structured observations, enforces membership and admin opt-out, and covers recovery", async () => {
    const target = new URL(url!);
    if (
      target.hostname !== "127.0.0.1" ||
      !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    )
      throw new Error("A dedicated loopback test database is required");
    const pool = new Pool({ connectionString: url, ssl: false });
    const client = await pool.connect();
    const viewer = randomUUID(),
      source = randomUUID(),
      outsider = randomUUID(),
      member = randomUUID(),
      a = randomUUID(),
      b = randomUUID(),
      schema = randomUUID();
    const event = "2099sharing" + Date.now(),
      robot = "frc99998",
      match = event + "_qm1";
    try {
      await client.query("BEGIN");
      for (const [id, name] of [
        [viewer, "viewer"],
        [source, "source"],
        [outsider, "outsider"],
        [member, "member"],
      ]) {
        await client.query(
          "INSERT INTO users(id,email,name) VALUES($1,$2,$3)",
          [id, id + "@example.test", name],
        );
        await client.query(
          "INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01')",
          [id],
        );
      }
      for (const [id, owner] of [
        [a, viewer],
        [b, source],
      ]) {
        await client.query(
          "INSERT INTO organizations(id,name,slug,team_number) VALUES($1::uuid,'Network test',$1::text,$2)",
          [id, id === a ? 99997 : 99998],
        );
        await client.query(
          "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')",
          [id, owner],
        );
      }
      await client.query(
        "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'scout')",
        [b, member],
      );
      await client.query(
        "INSERT INTO events_ref(event_key,year,name) VALUES($1,2099,'Network test')",
        [event],
      );
      await client.query(
        "INSERT INTO teams_ref(team_key,team_number,name) VALUES($1,99998,'Network robot') ON CONFLICT DO NOTHING",
        [robot],
      );
      await client.query(
        "INSERT INTO matches_ref(match_key,event_key,comp_level,set_number,match_number,red_alliance,blue_alliance) VALUES($1,$2,'qm',1,1,'[]','[]')",
        [match, event],
      );
      const fields = [
        { key: "cycles", label: "Cycles", type: "counter" },
        {
          key: "climb",
          label: "Climb",
          type: "select",
          options: ["none", "full"],
        },
        { key: "notes", label: "Notes", type: "text" },
        { key: "scoutNumber", label: "Scout number", type: "number" },
        {
          key: "badSelect",
          label: "Unvalidated selection",
          type: "select",
          options: ["valid"],
        },
        {
          key: "path",
          label: "Auto path",
          type: "auto_path",
          config: { gridCols: 8, gridRows: 4, secret: "PRIVATE" },
        },
        { key: "malformed", label: "Path", type: "auto_path" },
        {
          key: "start",
          label: "Starting positions",
          type: "field_position",
          config: { gridCols: 8, gridRows: 4 },
        },
      ];
      await client.query(
        "INSERT INTO scout_schemas(id,org_id,year,type,version,schema,created_by) VALUES($1,$2,2099,'match',1,$3,$4)",
        [schema, b, JSON.stringify({ fields }), source],
      );
      await client.query(
        "INSERT INTO match_scout_entries(org_id,event_key,match_key,team_key,scout_user_id,schema_id,payload,client_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          b,
          event,
          match,
          robot,
          source,
          schema,
          JSON.stringify({
            cycles: 0,
            climb: "full",
            notes: "PRIVATE",
            scoutNumber: 42,
            badSelect: "PERSONAL",
            path: [1, 2, 3],
            start: [4, 5],
            malformed: ["PRIVATE"],
            _scoutIdentity: { name: "PRIVATE" },
          }),
          randomUUID(),
        ],
      );
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true)", [viewer]);
      const shared = () =>
        client.query("SELECT * FROM get_shared_scout_observations($1,$2,$3)", [
          a,
          robot,
          event,
        ]);
      expect(
        (
          await client.query(
            "SELECT * FROM match_scout_entries WHERE org_id=$1",
            [b],
          )
        ).rowCount,
      ).toBe(0);
      const rows = (await shared()).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({
        cycles: 0,
        climb: "full",
        path: [1, 2, 3],
        start: [4, 5],
      });
      expect(
        rows[0].fields.find((field: { key: string }) => field.key === "path")
          .config,
      ).toEqual({ gridCols: 8, gridRows: 4 });
      expect(JSON.stringify(rows)).not.toContain("PRIVATE");
      expect(JSON.stringify(rows)).not.toContain(source);
      expect(rows[0].source_org_id).toBe(b);
      await client.query("SAVEPOINT denied");
      await client.query("SELECT set_config('app.user_id',$1,true)", [
        outsider,
      ]);
      await expect(shared()).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT denied");
      await client.query("SELECT set_config('app.user_id',$1,true)", [member]);
      await client.query("SAVEPOINT member_write");
      await expect(
        client.query(
          "INSERT INTO org_scouting_sharing(org_id,enabled,updated_by) VALUES($1,false,$2)",
          [b, member],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT member_write");
      await client.query("SELECT set_config('app.user_id',$1,true)", [source]);
      await client.query(
        "INSERT INTO org_scouting_sharing(org_id,enabled,updated_by) VALUES($1,false,$2)",
        [b, source],
      );
      await client.query("SELECT set_config('app.user_id',$1,true)", [viewer]);
      expect((await shared()).rowCount).toBe(0);
      await client.query("SELECT set_config('app.user_id',$1,true)", [source]);
      await client.query(
        "UPDATE org_scouting_sharing SET enabled=true WHERE org_id=$1",
        [b],
      );
      await client.query("SELECT set_config('app.user_id',$1,true)", [viewer]);
      expect((await shared()).rowCount).toBe(1);
      await client.query("RESET ROLE");
      const trigger = await client.query(
        "SELECT 1 FROM pg_trigger WHERE tgrelid='org_scouting_sharing'::regclass AND NOT tgisinternal AND tgname LIKE '%recovery%'",
      );
      expect(trigger.rowCount).toBeGreaterThan(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  });
});
