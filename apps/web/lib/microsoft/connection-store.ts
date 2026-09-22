/**
 * Reads and writes for org_microsoft_connections / workbook_sync_runs (migration 0671).
 * Parameterized SQL on the caller's withRls client only.
 *
 * The refresh token is envelope-encrypted with the same helpers as the BYO AI keys
 * (packages/billing encryptSecret / decryptSecret + createKms) and is never selected by
 * anything a member's request runs: members read org_microsoft_connection_status, a view
 * with no ciphertext columns.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { createKms, decryptSecret, encryptSecret, type EncryptedSecret } from "@vantage/billing";
import type { MicrosoftAccount, WorkbookFile } from "./workbook-target";

export type ConnectionStatus = {
  accountName: string | null;
  accountEmail: string | null;
  workbookItemId: string | null;
  workbookWebUrl: string | null;
  workbookName: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

export type SyncRunView = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "partial" | "failed";
  rowsWritten: number;
  tablesWritten: Record<string, { rows: number; ok: boolean; error?: string }>;
  error: string | null;
};

/** Deploys do not run migrations: until 0671 is applied the tables do not exist (42P01). */
export function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === "42P01" ||
    /relation "?(org_microsoft_connections|org_microsoft_connection_status|workbook_sync_runs)"? does not exist/i.test(
      String((error as Error | null)?.message ?? ""),
    )
  );
}

export const NOT_MIGRATED_MESSAGE =
  "Microsoft Excel sync is not switched on for this server yet. It needs a database update (migration 0671).";

export async function readConnectionStatus(client: PoolClient, orgId: string): Promise<ConnectionStatus | null> {
  const row = (
    await client.query<ConnectionStatus>(
      `SELECT account_name AS "accountName", account_email AS "accountEmail",
              workbook_item_id AS "workbookItemId", workbook_web_url AS "workbookWebUrl",
              workbook_name AS "workbookName",
              connected_at::text AS "connectedAt", last_sync_at::text AS "lastSyncAt",
              last_error AS "lastError", last_error_at::text AS "lastErrorAt"
         FROM org_microsoft_connection_status
        WHERE org_id = $1::uuid
        LIMIT 1`,
      [orgId],
    )
  ).rows[0];
  return row ?? null;
}

export async function listRecentRuns(client: PoolClient, orgId: string, limit = 5): Promise<SyncRunView[]> {
  const rows = (
    await client.query<SyncRunView & { rowsWritten: number | string }>(
      `SELECT id::text AS id, started_at::text AS "startedAt", finished_at::text AS "finishedAt", status,
              rows_written AS "rowsWritten", tables_written AS "tablesWritten", error
         FROM workbook_sync_runs
        WHERE org_id = $1::uuid
        ORDER BY started_at DESC
        LIMIT $2::int`,
      [orgId, Math.min(Math.max(1, limit), 20)],
    )
  ).rows;
  return rows.map((row) => ({
    ...row,
    rowsWritten: Number(row.rowsWritten) || 0,
    tablesWritten: row.tablesWritten && typeof row.tablesWritten === "object" ? row.tablesWritten : {},
  }));
}

type SecretRow = {
  ciphertext: string;
  nonce: string;
  authTag: string;
  encryptedDek: string;
  kmsKeyId: string;
  workbookItemId: string | null;
  workbookName: string | null;
};

/** Owner/admin requests only — RLS returns no row to anyone else. */
export async function readConnectionSecret(
  client: PoolClient,
  orgId: string,
): Promise<{ refreshToken: EncryptedSecret; workbookItemId: string | null; workbookName: string | null } | null> {
  const row = (
    await client.query<SecretRow>(
      `SELECT refresh_token_ciphertext AS ciphertext, refresh_token_nonce AS nonce,
              refresh_token_auth_tag AS "authTag", encrypted_dek AS "encryptedDek", kms_key_id AS "kmsKeyId",
              workbook_item_id AS "workbookItemId", workbook_name AS "workbookName"
         FROM org_microsoft_connections
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
    workbookItemId: row.workbookItemId,
    workbookName: row.workbookName,
  };
}

export function encryptRefreshToken(token: string): Promise<EncryptedSecret> {
  return encryptSecret(token, createKms());
}

export function decryptRefreshToken(secret: EncryptedSecret): Promise<string> {
  return decryptSecret(secret, createKms());
}

export async function saveConnection(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    refreshToken: EncryptedSecret;
    account: MicrosoftAccount;
    workbook: WorkbookFile;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO org_microsoft_connections
       (org_id, refresh_token_ciphertext, refresh_token_nonce, refresh_token_auth_tag, encrypted_dek, kms_key_id,
        account_name, account_email, workbook_item_id, workbook_web_url, workbook_name, connected_by, connected_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, now())
     ON CONFLICT (org_id) DO UPDATE SET
       refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
       refresh_token_nonce = EXCLUDED.refresh_token_nonce,
       refresh_token_auth_tag = EXCLUDED.refresh_token_auth_tag,
       encrypted_dek = EXCLUDED.encrypted_dek,
       kms_key_id = EXCLUDED.kms_key_id,
       account_name = EXCLUDED.account_name,
       account_email = EXCLUDED.account_email,
       workbook_item_id = EXCLUDED.workbook_item_id,
       workbook_web_url = EXCLUDED.workbook_web_url,
       workbook_name = EXCLUDED.workbook_name,
       connected_by = EXCLUDED.connected_by,
       connected_at = now(),
       last_error = NULL,
       last_error_at = NULL,
       updated_at = now()`,
    [
      input.orgId,
      input.refreshToken.ciphertext,
      input.refreshToken.nonce,
      input.refreshToken.authTag,
      input.refreshToken.encryptedDek,
      input.refreshToken.kmsKeyId,
      input.account.displayName,
      input.account.email,
      input.workbook.itemId,
      input.workbook.webUrl,
      input.workbook.name,
      input.userId,
    ],
  );
}

/** Microsoft rotates refresh tokens; the newest one replaces the stored one. */
export async function storeRotatedRefreshToken(client: PoolClient, orgId: string, secret: EncryptedSecret): Promise<void> {
  await client.query(
    `UPDATE org_microsoft_connections
        SET refresh_token_ciphertext = $2, refresh_token_nonce = $3, refresh_token_auth_tag = $4,
            encrypted_dek = $5, kms_key_id = $6, updated_at = now()
      WHERE org_id = $1::uuid`,
    [orgId, secret.ciphertext, secret.nonce, secret.authTag, secret.encryptedDek, secret.kmsKeyId],
  );
}

export async function storeWorkbookLocation(client: PoolClient, orgId: string, workbook: WorkbookFile): Promise<void> {
  await client.query(
    `UPDATE org_microsoft_connections
        SET workbook_item_id = $2, workbook_web_url = $3, workbook_name = $4, updated_at = now()
      WHERE org_id = $1::uuid`,
    [orgId, workbook.itemId, workbook.webUrl, workbook.name],
  );
}

export async function recordConnectionError(client: PoolClient, orgId: string, message: string): Promise<void> {
  await client.query(
    `UPDATE org_microsoft_connections
        SET last_error = $2, last_error_at = now(), updated_at = now()
      WHERE org_id = $1::uuid`,
    [orgId, message.slice(0, 500)],
  );
}

export async function deleteConnection(client: PoolClient, orgId: string): Promise<boolean> {
  const result = await client.query(`DELETE FROM org_microsoft_connections WHERE org_id = $1::uuid`, [orgId]);
  return (result.rowCount ?? 0) > 0;
}

export async function readWorkbookNaming(
  client: PoolClient,
  orgId: string,
): Promise<{ orgName: string; teamNumber: number | null }> {
  const row = (
    await client.query<{ name: string; teamNumber: number | null }>(
      `SELECT name, team_number AS "teamNumber" FROM organizations WHERE id = $1::uuid`,
      [orgId],
    )
  ).rows[0];
  return { orgName: row?.name ?? "Team", teamNumber: row?.teamNumber ?? null };
}
