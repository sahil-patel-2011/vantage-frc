import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { insertSponsorContribution } from "./sponsor-contribution";
import { syncSponsorContributionMoney } from "../finance/source-mirrors";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;
suite("sponsor cash and in-kind records in PostgreSQL", () => {
  it("preserves numeric amounts, excludes in-kind estimates from cash, and rejects another team's sponsor", async () => {
    const target = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || !target.pathname.includes("test")) throw new Error("Dedicated local test database required.");
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    const client = db as unknown as import("@neondatabase/serverless").PoolClient;
    const org = randomUUID(), other = randomUUID(), user = randomUUID(), sponsor = randomUUID();
    try {
      await db.query("BEGIN");
      await db.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Sponsor transaction fixture')", [user, `${user}@example.test`]);
      await db.query("INSERT INTO profiles(user_id,date_of_birth,team_role) VALUES($1,'2000-01-01','mentor')", [user]);
      await db.query("INSERT INTO organizations(id,slug,name) VALUES($1::uuid,$1::text,'Sponsor fixture'),($2::uuid,$2::text,'Other sponsor fixture')", [org, other]);
      await db.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [org, user]);
      await db.query("INSERT INTO sponsors(id,org_id,name,created_by) VALUES($1,$2,'Synthetic sponsor',$3)", [sponsor, org, user]);
      await db.query("SET LOCAL ROLE vantage_app");
      await db.query("SELECT set_config('app.user_id',$1,true)", [user]);
      const input = { orgId: org, sponsorId: sponsor, seasonYear: 2026, amountUsd: 25.37, receivedOn: "2026-09-26", description: "Synthetic fixture only", userId: user };
      const cashId = await insertSponsorContribution(client, { ...input, contributionType: "cash" });
      expect(cashId).toBeTruthy();
      await syncSponsorContributionMoney(client, { ...input, contributionId: cashId!, contributionType: "cash", receivedAt: input.receivedOn });
      // Repeating mirror writes updates one source row rather than counting it twice.
      await syncSponsorContributionMoney(client, { ...input, contributionId: cashId!, contributionType: "cash", receivedAt: input.receivedOn });
      const kindId = await insertSponsorContribution(client, { ...input, amountUsd: 80.12, contributionType: "in_kind" });
      await syncSponsorContributionMoney(client, { ...input, contributionId: kindId!, contributionType: "in_kind", amountUsd: null });
      const rows = (await db.query("SELECT amount_usd::text,estimated_value_usd::text FROM sponsor_contributions WHERE org_id=$1 ORDER BY type", [org])).rows;
      expect(rows).toEqual([{ amount_usd: "25.37", estimated_value_usd: null }, { amount_usd: null, estimated_value_usd: "80.12" }]);
      const ledger = (await db.query("SELECT amount_usd::text,source_id FROM finance_transactions WHERE org_id=$1", [org])).rows;
      expect(ledger).toEqual([{ amount_usd: "25.37", source_id: cashId }]);
      expect(await insertSponsorContribution(client, { ...input, orgId: other, contributionType: "cash" })).toBeNull();
    } finally { await db.query("ROLLBACK"); await db.end(); }
  });
});
