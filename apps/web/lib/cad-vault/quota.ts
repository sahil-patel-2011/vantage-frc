/**
 * Vault quotas, enforced with the SELECT COUNT/SUM pre-check pattern from
 * api/business/assets before any INSERT. The evaluation itself is pure so it
 * is unit-testable without a database.
 */

import type { PoolClient } from "@neondatabase/serverless";

export const MAX_CAD_FILE_BYTES = 50 * 1024 * 1024; // matches byte_size CHECK (52428800)
export const MAX_ORG_CAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB per org
export const MAX_VERSIONS_PER_DOCUMENT = 50;

export type CadUsage = {
  orgBytes: number;
  documentVersionCount: number;
};

export type QuotaVerdict = { ok: true } | { ok: false; reason: string };

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function evaluateCadQuota(fileBytes: number, usage: CadUsage): QuotaVerdict {
  if (fileBytes <= 0) return { ok: false, reason: "The file is empty." };
  if (fileBytes > MAX_CAD_FILE_BYTES) {
    return {
      ok: false,
      reason: `This file is ${formatMb(fileBytes)}; the per-file limit is ${formatMb(MAX_CAD_FILE_BYTES)}. Export a lighter mesh or split the assembly.`,
    };
  }
  if (usage.documentVersionCount >= MAX_VERSIONS_PER_DOCUMENT) {
    return {
      ok: false,
      reason: `This document already has ${MAX_VERSIONS_PER_DOCUMENT} versions. Archive it and start a new document to keep uploading.`,
    };
  }
  if (usage.orgBytes + fileBytes > MAX_ORG_CAD_BYTES) {
    return {
      ok: false,
      reason: `Your team's vault holds ${formatMb(usage.orgBytes)} of ${formatMb(MAX_ORG_CAD_BYTES)}; this upload would exceed the limit. Delete superseded versions first.`,
    };
  }
  return { ok: true };
}

export async function fetchCadUsage(client: PoolClient, orgId: string, documentId: string): Promise<CadUsage> {
  const usage = await client.query<{ orgBytes: string; documentVersionCount: string }>(
    `SELECT
       COALESCE(SUM(byte_size), 0)::text AS "orgBytes",
       COUNT(*) FILTER (WHERE document_id = $2::uuid)::text AS "documentVersionCount"
     FROM cad_document_versions WHERE org_id = $1::uuid`,
    [orgId, documentId],
  );
  return {
    orgBytes: Number(usage.rows[0]?.orgBytes ?? 0),
    documentVersionCount: Number(usage.rows[0]?.documentVersionCount ?? 0),
  };
}
