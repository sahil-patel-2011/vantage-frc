import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { unreadNotificationCount, updateInboxReadState } from "./inbox-store";
const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe : describe.skip;
suite("actual PostgreSQL personal/team notification state", () => {
  it("matches badge scope, acknowledges only shown rows, preserves history and rejects cross-person/team mutations", async () => {
    const target = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(decodeURIComponent(target.pathname.slice(1)))) throw new Error("Dedicated loopback test/CI database required");
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    const client = await pool.connect();
    const user = randomUUID(), other = randomUUID(), orgA = randomUUID(), orgB = randomUUID();
    const a = randomUUID(), unseen = randomUUID(), b = randomUUID(), global = randomUUID(), foreign = randomUUID(), deleted = randomUUID();
    try {
      await client.query("BEGIN");
      for (const actor of [user, other]) {
        await client.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Inbox fixture')", [actor, `${actor}@example.test`]);
        await client.query("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01')", [actor]);
      }
      for (const org of [orgA, orgB]) {
        await client.query("INSERT INTO organizations(id,slug,name) VALUES($1::uuid,$1::text,'Inbox fixture')", [org]);
        await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [org, user]);
      }
      for (const [id, actor, org] of [[a,user,orgA],[unseen,user,orgA],[b,user,orgB],[global,user,null],[foreign,other,orgA]]) {
        await client.query("INSERT INTO notifications(id,user_id,org_id,type) VALUES($1,$2,$3,'test')", [id, actor, org]);
      }
      await client.query("INSERT INTO notifications(id,user_id,org_id,type,payload) VALUES($1,$2,$3,'team_announcement',$4)", [deleted,user,orgA,JSON.stringify({announcementId:randomUUID()})]);
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.org_id',$2,true)", [user,orgA]);
      expect(await unreadNotificationCount(client,user,orgA)).toBe(3);
      expect(await unreadNotificationCount(client,user,orgB)).toBe(2);
      expect(await unreadNotificationCount(client,other,orgA)).toBe(0);
      const result = await updateInboxReadState(client,user,orgA,"read_visible",[a,b,foreign]);
      expect(result.updated).toBe(1);
      expect(result.unreadCount).toBe(2);
      expect(result.items.map(row=>row.id)).toEqual([a]);
      const again = await updateInboxReadState(client,user,orgA,"read_visible",[a]);
      expect(again.items[0].readAt).toBe(result.items[0].readAt);
      expect((await client.query("SELECT count(*)::int AS count FROM notifications WHERE user_id=$1",[user])).rows[0].count).toBe(5);
      await updateInboxReadState(client,user,orgA,"unread",[a]);
      expect(await unreadNotificationCount(client,user,orgA)).toBe(3);
      const all = await updateInboxReadState(client,user,orgA,"read_all",[]);
      expect(all.unreadCount).toBe(0);
      expect(await unreadNotificationCount(client,user,orgB)).toBe(1);
      await client.query("SAVEPOINT cross_person");
      await expect(updateInboxReadState(client,user,orgA,"read",[foreign])).rejects.toThrow("not found");
      await client.query("ROLLBACK TO SAVEPOINT cross_person");
      await client.query("SAVEPOINT cross_team");
      await expect(updateInboxReadState(client,user,orgA,"read",[b])).rejects.toThrow("not found");
      await client.query("ROLLBACK TO SAVEPOINT cross_team");
      // A live announcement remains countable without app.org_id, as in
      // /api/me. Removing its source must remove the badge, not its history.
      const announcement = randomUUID(), alert = randomUUID();
      await client.query("INSERT INTO team_announcements(id,org_id,title,created_by) VALUES($1,$2,'Live fixture',$3)", [announcement,orgA,user]);
      await client.query("INSERT INTO notifications(id,user_id,org_id,type,payload) VALUES($1,$2,$3,'team_announcement',$4)", [alert,user,orgA,JSON.stringify({announcementId:announcement})]);
      await client.query("SELECT set_config('app.org_id','',true)");
      expect(await unreadNotificationCount(client,user,orgA)).toBe(1);
      await client.query("DELETE FROM team_announcements WHERE id=$1", [announcement]);
      expect(await unreadNotificationCount(client,user,orgA)).toBe(0);
      expect((await client.query("SELECT read_at FROM notifications WHERE id=$1",[alert])).rows).toEqual([{read_at:null}]);
    } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
  });
});
