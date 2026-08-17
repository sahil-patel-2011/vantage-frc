import type { PoolClient } from "@neondatabase/serverless";

export async function claimFrcTeamWorkspace(
  client: PoolClient,
  actorUserId: string,
  input: { name: string; slug: string; teamNumber: number },
): Promise<string> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
    throw new Error("Slug must use lowercase letters, numbers, and hyphens");
  }
  if (!Number.isInteger(input.teamNumber) || input.teamNumber < 1 || input.teamNumber > 99999) {
    throw new Error("Team number must be between 1 and 99999");
  }
  const result = await client.query<{ id: string }>(
    `SELECT claim_frc_team_workspace($1, $2, $3) AS id`,
    [input.name.trim(), input.slug, input.teamNumber],
  );
  const orgId = result.rows[0]?.id;
  if (!orgId) throw new Error("Could not claim this FRC team");
  void actorUserId;
  return orgId;
}
