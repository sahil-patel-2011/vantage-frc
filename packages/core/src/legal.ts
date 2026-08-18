import type { PoolClient } from "@neondatabase/serverless";

export const LEGAL_DOC_VERSION = "2026-08-17";
export const LEGAL_EFFECTIVE_DATE = "August 17, 2026";

export function assertTermsAccepted(accepted: unknown): void {
  if (accepted !== true) {
    throw new Error("You must agree to the Terms of Service and Privacy Policy to continue.");
  }
}

export async function recordLegalAcceptance(
  client: PoolClient,
  userId: string,
  version: string = LEGAL_DOC_VERSION,
): Promise<void> {
  await client.query(
    `INSERT INTO profiles (user_id, terms_accepted_at, terms_version)
     VALUES ($1::uuid, now(), $2)
     ON CONFLICT (user_id) DO UPDATE SET
       terms_accepted_at = now(),
       terms_version = EXCLUDED.terms_version`,
    [userId, version],
  );
}