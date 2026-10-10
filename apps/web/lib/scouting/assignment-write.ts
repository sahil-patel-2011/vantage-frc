import type { PoolClient } from "@neondatabase/serverless";

/** All assignment publishers take the same lock before reading conflicts, inside withRls. */
export async function lockAssignmentEvent(client: PoolClient, orgId: string, eventKey: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `scout-assignments:${orgId.toLowerCase()}:${eventKey.toLowerCase()}`,
  ]);
}
