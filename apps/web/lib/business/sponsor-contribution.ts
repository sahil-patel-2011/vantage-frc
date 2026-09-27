import type { PoolClient } from "@neondatabase/serverless";

/** Caller owns the transaction that also records the ledger mirror and follow-up dates. */
export async function insertSponsorContribution(client: PoolClient, input: {
  orgId: string; sponsorId: string; seasonYear: number; contributionType: "cash" | "in_kind";
  amountUsd: number; receivedOn: string; description: string | null; userId: string;
}): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO sponsor_contributions(
       org_id, sponsor_id, season_year, type, amount_usd, estimated_value_usd,
       received_at, description, created_by
     ) SELECT $1::uuid,id,$3::int,$4::sponsor_contribution_type,
              CASE WHEN $4::text = 'cash' THEN $5::numeric ELSE NULL::numeric END,
              CASE WHEN $4::text <> 'cash' THEN $5::numeric ELSE NULL::numeric END,
              $6::date,$7::text,$8::uuid FROM sponsors
        WHERE id = $2::uuid AND org_id = $1::uuid RETURNING id`,
    [input.orgId, input.sponsorId, input.seasonYear, input.contributionType, input.amountUsd, input.receivedOn, input.description, input.userId],
  );
  return result.rows[0]?.id ?? null;
}
