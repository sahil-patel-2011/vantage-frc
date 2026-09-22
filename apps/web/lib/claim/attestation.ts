/**
 * The authorization statement a person makes when they claim an FRC team number
 * on /claim, and the server-side record of it (migration 0672).
 *
 * Client-safe on purpose: the wording and the version live here so the checkbox
 * on /claim and the row the claim route writes can never say different things.
 * The DB write takes a PoolClient as a type only — no `pg` import reaches the
 * browser bundle.
 *
 * The statement text stored is always rebuilt on the server from the team
 * number being claimed. Whatever wording a client sends is ignored: the record
 * has to say what the product showed, not what a request body claims it showed.
 */

import type { PoolClient } from "@neondatabase/serverless";

/**
 * Bump when the wording changes. A client still showing an older wording is
 * refused (see {@link parseClaimAttestation}), so a stored row always matches
 * the words the person actually ticked.
 */
export const TEAM_CLAIM_STATEMENT_VERSION = "2026-09-22.1";

/** The exact words next to the /claim checkbox, with the team number filled in. */
export function teamClaimStatement(teamNumber: number | string): string {
  const label = String(teamNumber).trim() || "N";
  return (
    `I confirm I am a member, mentor or coach of Team ${label} and am authorized to register it on Vantage. ` +
    "I understand that claiming another team's number is prohibited."
  );
}

export const CLAIM_ATTESTATION_MISSING_MESSAGE =
  "Confirm that you are a member, mentor or coach of this team and are authorized to register it.";
export const CLAIM_ATTESTATION_STALE_MESSAGE =
  "The authorization statement on this page has changed. Reload the page, read it again, and confirm.";

export type ClaimAttestationInput = {
  authorizationAcknowledged?: unknown;
  attestationVersion?: unknown;
};

export type ClaimAttestationCheck =
  | { ok: true; version: string }
  | { ok: false; message: string };

/**
 * Server gate. Only the literal boolean `true` counts — `"true"`, `1` or a
 * missing field is not an acknowledgement. The version must be the current one.
 */
export function parseClaimAttestation(body: ClaimAttestationInput | null | undefined): ClaimAttestationCheck {
  if (!body || body.authorizationAcknowledged !== true) {
    return { ok: false, message: CLAIM_ATTESTATION_MISSING_MESSAGE };
  }
  if (body.attestationVersion !== TEAM_CLAIM_STATEMENT_VERSION) {
    return { ok: false, message: CLAIM_ATTESTATION_STALE_MESSAGE };
  }
  return { ok: true, version: TEAM_CLAIM_STATEMENT_VERSION };
}

/**
 * Writes the statement row. Must run inside the same `withRls` transaction as
 * the claim itself — the insert policy requires the caller to already own the
 * org, and a failure here must roll the claim back.
 */
export async function recordTeamClaimAttestation(
  client: Pick<PoolClient, "query">,
  input: { orgId: string; userId: string; teamNumber: number; ipHash: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO team_claim_attestations
       (org_id, user_id, team_number, statement_version, statement, ip_hash)
     VALUES ($1::uuid, $2::uuid, $3::integer, $4::text, $5::text, $6::text)`,
    [
      input.orgId,
      input.userId,
      input.teamNumber,
      TEAM_CLAIM_STATEMENT_VERSION,
      teamClaimStatement(input.teamNumber),
      input.ipHash,
    ],
  );
}

/** Where to report a team number claimed by someone who does not represent the team. */
export function teamClaimReportHref(teamNumber: number | string | null | undefined): string {
  const value = teamNumber == null ? "" : String(teamNumber).trim();
  return /^\d{1,5}$/.test(value) ? `/claim/report?team=${value}` : "/claim/report";
}
