/**
 * Reads and writes for org_google_sheets_connections (migration 0682).
 *
 * The refresh token is envelope-encrypted with the same KMS as the Microsoft connection
 * and AI keys (encryptRefreshToken). Request-path only: every query runs on the caller's
 * withRls client, and RLS returns the secret row to owners and admins alone.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { EncryptedSecret } from "@vantage/billing";
import type { GoogleAccount } from "./google-api";
import type { GoogleSpreadsheet } from "./sheets-target";

export type GoogleConnectionStatus = {
  accountName: string | null;
  accountEmail: string | null;
  spreadsheetId: string | null;
  spreadsheetUrl: string | null;
  spreadsheetName: string | null;
  connectedAt: string;
  lastSyncAt: string | null;
  lastSyncHash: string | null;
  lastReadAt: string | null;
  throttledUntil: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

/** Until 0682 is applied the Google tables and the mirror columns do not exist. */
export function isMirrorNotMigrated(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = String((error as Error | null)?.message ?? "");
  return (
    code === "42P01" ||
    code === "42703" ||
    /relation "?(org_google_sheets_connections|org_google_sheets_connection_status)"? does not exist/i.test(message) ||
    /column "?(last_sync_hash|throttled_until|last_read_at|target|content_hash)"? does not exist/i.test(message)
  );
}

export const MIRROR_NOT_MIGRATED_MESSAGE =
  "The Google Sheets copy is not switched on for this server yet. It needs a database update (migration 0682).";

export async function readGoogleConnectionStatus(client: PoolClient, orgId: string): Promise<GoogleConnectionStatus | null> {
  const row = (
    await client.query<GoogleConnectionStatus>(
      `SELECT account_name AS "accountName", account_email AS "accountEmail",
              spreadsheet_id AS "spreadsheetId", spreadsheet_url AS "spreadsheetUrl",
              spreadsheet_name AS "spreadsheetName",
              connected_at::text AS "connectedAt", last_sync_at::text AS "lastSyncAt",
              last_sync_hash AS "lastSyncHash", last_read_at::text AS "lastReadAt",
              throttled_until::text AS "throttledUntil",
              last_error AS "lastError", last_error_at::text AS "lastErrorAt"
         FROM org_google_sheets_connection_status
        WHERE org_id = $1::uuid
        LIMIT 1`,
      [orgId],
    )
  ).rows[0];
  return row ?? null;
}

type SecretRow = {
  ciphertext: string;
  nonce: string;
  authTag: string;
  encryptedDek: string;
  kmsKeyId: string;
  spreadsheetId: string | null;
  spreadsheetName: string | null;
};

/** Owner/admin requests only — RLS returns no row to anyone else. */
export async function readGoogleConnectionSecret(
  client: PoolClient,
  orgId: string,
): Promise<{ refreshToken: EncryptedSecret; spreadsheetId: string | null; spreadsheetName: string | null } | null> {
  const row = (
    await client.query<SecretRow>(
      `SELECT refresh_token_ciphertext AS ciphertext, refresh_token_nonce AS nonce,
              refresh_token_auth_tag AS "authTag", encrypted_dek AS "encryptedDek", kms_key_id AS "kmsKeyId",
              spreadsheet_id AS "spreadsheetId", spreadsheet_name AS "spreadsheetName"
         FROM org_google_sheets_connections
        WHERE org_id = $1::uuid
        LIMIT 1`,
      [orgId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    refreshToken: {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.authTag,
      encryptedDek: row.encryptedDek,
      kmsKeyId: row.kmsKeyId,
    },
    spreadsheetId: row.spreadsheetId,
    spreadsheetName: row.spreadsheetName,
  };
}

export async function saveGoogleConnection(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    refreshToken: EncryptedSecret;
    account: GoogleAccount;
    spreadsheet: GoogleSpreadsheet | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO org_google_sheets_connections
       (org_id, refresh_token_ciphertext, refresh_token_nonce, refresh_token_auth_tag, encrypted_dek, kms_key_id,
        account_name, account_email, spreadsheet_id, spreadsheet_url, spreadsheet_name, connected_by, connected_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, now())
     ON CONFLICT (org_id) DO UPDATE SET
       refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
       refresh_token_nonce = EXCLUDED.refresh_token_nonce,
       refresh_token_auth_tag = EXCLUDED.refresh_token_auth_tag,
       encrypted_dek = EXCLUDED.encrypted_dek,
       kms_key_id = EXCLUDED.kms_key_id,
       account_name = EXCLUDED.account_name,
       account_email = EXCLUDED.account_email,
       spreadsheet_id = COALESCE(EXCLUDED.spreadsheet_id, org_google_sheets_connections.spreadsheet_id),
       spreadsheet_url = COALESCE(EXCLUDED.spreadsheet_url, org_google_sheets_connections.spreadsheet_url),
       spreadsheet_name = COALESCE(EXCLUDED.spreadsheet_name, org_google_sheets_connections.spreadsheet_name),
       connected_by = EXCLUDED.connected_by,
       connected_at = now(),
       last_error = NULL,
       last_error_at = NULL,
       throttled_until = NULL,
       updated_at = now()`,
    [
      input.orgId,
      input.refreshToken.ciphertext,
      input.refreshToken.nonce,
      input.refreshToken.authTag,
      input.refreshToken.encryptedDek,
      input.refreshToken.kmsKeyId,
      input.account.name,
      input.account.email,
      input.spreadsheet?.spreadsheetId ?? null,
      input.spreadsheet?.url ?? null,
      input.spreadsheet?.name ?? null,
      input.userId,
    ],
  );
}

export async function storeGoogleRefreshToken(client: PoolClient, orgId: string, secret: EncryptedSecret): Promise<void> {
  await client.query(
    `UPDATE org_google_sheets_connections
        SET refresh_token_ciphertext = $2, refresh_token_nonce = $3, refresh_token_auth_tag = $4,
            encrypted_dek = $5, kms_key_id = $6, updated_at = now()
      WHERE org_id = $1::uuid`,
    [orgId, secret.ciphertext, secret.nonce, secret.authTag, secret.encryptedDek, secret.kmsKeyId],
  );
}

export async function storeSpreadsheetLocation(client: PoolClient, orgId: string, sheet: GoogleSpreadsheet): Promise<void> {
  await client.query(
    `UPDATE org_google_sheets_connections
        SET spreadsheet_id = $2, spreadsheet_url = $3, spreadsheet_name = $4, updated_at = now()
      WHERE org_id = $1::uuid`,
    [orgId, sheet.spreadsheetId, sheet.url, sheet.name],
  );
}

export async function recordGoogleError(client: PoolClient, orgId: string, message: string): Promise<void> {
  await client.query(
    `UPDATE org_google_sheets_connections
        SET last_error = $2, last_error_at = now(), updated_at = now()
      WHERE org_id = $1::uuid`,
    [orgId, message.slice(0, 500)],
  );
}

export async function deleteGoogleConnection(client: PoolClient, orgId: string): Promise<boolean> {
  const result = await client.query(`DELETE FROM org_google_sheets_connections WHERE org_id = $1::uuid`, [orgId]);
  return (result.rowCount ?? 0) > 0;
}
