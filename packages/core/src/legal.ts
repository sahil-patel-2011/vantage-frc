import type { PoolClient } from "@neondatabase/serverless";

// Bumped 2026-08-24.2: the documents now disclose that AI-feature activity
// (prompts, context, responses, tool traces) may be used to train in-house
// models — a reversal of the earlier no-training language, so every member
// must re-accept. A new version string is what forces that re-acceptance;
// leaving it stale would silently hold people to terms they never saw.
export const LEGAL_DOC_VERSION = "2026-08-24.2";
export const LEGAL_EFFECTIVE_DATE = "August 24, 2026";

export const TERMS_MISSING_MESSAGE = "You must agree to the Terms of Service to continue.";
export const PRIVACY_MISSING_MESSAGE = "You must agree to the Privacy Policy to continue.";
export const BOTH_MISSING_MESSAGE =
  "You must agree to the Terms of Service and to the Privacy Policy to continue.";

export type LegalAcceptanceFlags = {
  termsAccepted?: unknown;
  privacyAccepted?: unknown;
};

/**
 * Terms and Privacy are two separate consents. Both must be sent explicitly as
 * `true`; anything else (missing, false, "true", 1) is not consent. The thrown
 * message names exactly which document is missing so the UI can point at the
 * right checkbox.
 */
export function assertLegalAccepted(flags: LegalAcceptanceFlags): void {
  const terms = flags.termsAccepted === true;
  const privacy = flags.privacyAccepted === true;
  if (!terms && !privacy) throw new Error(BOTH_MISSING_MESSAGE);
  if (!terms) throw new Error(TERMS_MISSING_MESSAGE);
  if (!privacy) throw new Error(PRIVACY_MISSING_MESSAGE);
}

/**
 * Records BOTH acceptances at the same instant and version. Only call this
 * after `assertLegalAccepted` has passed for the same request — writing a
 * privacy acceptance for someone who only ticked Terms would be a false record.
 */
export async function recordLegalAcceptance(
  client: PoolClient,
  userId: string,
  version: string = LEGAL_DOC_VERSION,
): Promise<void> {
  await client.query(
    `INSERT INTO profiles (user_id, terms_accepted_at, terms_version, privacy_accepted_at, privacy_version)
     VALUES ($1::uuid, now(), $2, now(), $2)
     ON CONFLICT (user_id) DO UPDATE SET
       terms_accepted_at = now(),
       terms_version = EXCLUDED.terms_version,
       privacy_accepted_at = now(),
       privacy_version = EXCLUDED.privacy_version`,
    [userId, version],
  );
}

/** True when this profile still owes one or both consents (0460 backfills nothing). */
export function legalAcceptanceRequired(input: {
  termsAcceptedAt?: string | null;
  privacyAcceptedAt?: string | null;
}): boolean {
  return !input.termsAcceptedAt?.trim() || !input.privacyAcceptedAt?.trim();
}
