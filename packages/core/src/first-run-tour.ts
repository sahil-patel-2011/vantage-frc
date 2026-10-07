import type { PoolClient } from "@neondatabase/serverless";
/** Atomically monotonic across devices; only onboarded, newly created accounts qualify. */
export async function claimFirstTour(client: PoolClient, userId: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE profiles SET app_tour_seen_at=now()
     WHERE user_id=$1 AND app_tour_seen_at IS NULL AND onboarding_completed_at IS NOT NULL
       AND EXISTS(SELECT 1 FROM users WHERE id=$1 AND created_at >= now() - interval '14 days')
     RETURNING user_id`, [userId],
  );
  return Boolean(result.rowCount);
}
