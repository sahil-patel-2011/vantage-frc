/**
 * The one way a file enters the CAD vault. Shared by the multipart upload route
 * and by the Onshape export path (agent tools + legacy job steps), so quota,
 * sha256 dedupe, STL geometry, and the thumbnail are computed identically no
 * matter where the bytes came from.
 */

import { createHash } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { detectCadFormat, type CadFormat } from "./format-detect";
import { cadStorageKey, safeCadFilename } from "./filenames";
import { evaluateCadQuota, fetchCadUsage, MAX_CAD_FILE_BYTES } from "./quota";
import { StlTooLargeError, computeStlGeometry, type StlGeometrySummary } from "./stl-geometry";
import { renderStlThumbnail } from "./stl-thumbnail";
import { currentSeasonYear, type CadDocumentKind } from "./view";

export type PreparedCadFile = {
  filename: string;
  format: CadFormat;
  mediaType: string;
  bytes: Buffer;
  checksum: string;
  geometry: StlGeometrySummary | Record<string, never>;
  thumbnail: Buffer | null;
};

export type StoredCadVersion = {
  duplicate: boolean;
  publicId: string;
  version: number;
  filename: string;
  format: string;
};

/**
 * Validate and pre-compute everything that does not need the database: format
 * by magic bytes, sha256, and (STL only) geometry + thumbnail. Throws with a
 * user-facing message on a rejected file.
 */
export async function prepareCadVaultFile(raw: Buffer, originalFilename: string): Promise<PreparedCadFile> {
  if (raw.length <= 0) throw new Error("The file is empty.");
  if (raw.length > MAX_CAD_FILE_BYTES) {
    throw new Error(
      `This file is ${Math.round(raw.length / (1024 * 1024))} MB; the per-file limit is 50 MB. Export a lighter mesh or split the assembly.`,
    );
  }
  const filename = safeCadFilename(originalFilename);
  const detection = detectCadFormat(raw, filename);
  if (!detection.ok) throw new Error(detection.reason);
  const checksum = createHash("sha256").update(raw).digest("hex");

  // Geometry only for formats we truly parse (STL). Everything else stays {} —
  // the UI states "no geometry summary for this format" instead of showing zeros.
  let geometry: StlGeometrySummary | Record<string, never> = {};
  let thumbnail: Buffer | null = null;
  if (detection.format === "stl") {
    try {
      geometry = computeStlGeometry(raw);
      thumbnail = await renderStlThumbnail(raw);
    } catch (error) {
      if (error instanceof StlTooLargeError) throw error;
      geometry = {}; // parse failed after detection: store the file, no summary
    }
  }
  return { filename, format: detection.format, mediaType: detection.mediaType, bytes: raw, checksum, geometry, thumbnail };
}

/**
 * Lock the document row (serializes concurrent uploads on current_version),
 * verify tenancy, and return the locked state.
 */
export async function lockCadDocument(client: PoolClient, documentId: string, orgId: string) {
  const document = await client.query<{ id: string; currentVersion: number }>(
    `SELECT id, current_version AS "currentVersion" FROM cad_documents
     WHERE id = $1::uuid AND org_id = $2::uuid FOR UPDATE`,
    [documentId, orgId],
  );
  return document.rows[0] ?? null;
}

/**
 * Store a prepared file as the next version of a document. Returns the existing
 * version (duplicate=true) when the same bytes are already on this document, so
 * an export that produced identical geometry does not burn a version or quota.
 */
export async function storeCadVaultVersion(
  client: PoolClient,
  input: { orgId: string; userId: string; documentId: string; file: PreparedCadFile; changeNote: string | null },
): Promise<StoredCadVersion> {
  const document = await lockCadDocument(client, input.documentId, input.orgId);
  if (!document) throw new Error("Document not found in this team.");
  const duplicate = await client.query<{ publicId: string; version: number; filename: string; format: string }>(
    `SELECT public_id AS "publicId", version, filename, format FROM cad_document_versions
     WHERE org_id = $1::uuid AND document_id = $2::uuid AND checksum_sha256 = $3
     ORDER BY version DESC LIMIT 1`,
    [input.orgId, input.documentId, input.file.checksum],
  );
  if (duplicate.rows[0]) {
    const row = duplicate.rows[0];
    return { duplicate: true, publicId: row.publicId, version: Number(row.version), filename: row.filename, format: row.format };
  }
  const usage = await fetchCadUsage(client, input.orgId, input.documentId);
  const verdict = evaluateCadQuota(input.file.bytes.length, usage);
  if (!verdict.ok) throw new Error(verdict.reason);

  const version = document.currentVersion + 1;
  const storageKey = cadStorageKey(input.orgId, input.documentId, version, input.file.filename);
  const inserted = await client.query<{ publicId: string }>(
    `INSERT INTO cad_document_versions
       (org_id, document_id, version, filename, format, media_type, bytes, byte_size,
        checksum_sha256, storage_key, geometry, thumbnail_png, change_note, uploaded_by)
     VALUES ($1::uuid, $2::uuid, $3::int, $4, $5, $6, $7, $8::int, $9, $10, $11::jsonb, $12, $13, $14)
     RETURNING public_id AS "publicId"`,
    [
      input.orgId,
      input.documentId,
      version,
      input.file.filename,
      input.file.format,
      input.file.mediaType,
      input.file.bytes,
      input.file.bytes.length,
      input.file.checksum,
      storageKey,
      JSON.stringify(input.file.geometry),
      input.file.thumbnail,
      input.changeNote ? input.changeNote.slice(0, 500) : null,
      input.userId,
    ],
  );
  await client.query(
    `UPDATE cad_documents SET current_version = $3::int, updated_by = $4, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.documentId, input.orgId, version, input.userId],
  );
  return {
    duplicate: false,
    publicId: inserted.rows[0]!.publicId,
    version,
    filename: input.file.filename,
    format: input.file.format,
  };
}

/** Title as the vault stores it: trimmed and within the 160-char CHECK. */
export function cadVaultTitle(raw: string, fallback = "Part Studio export"): string {
  const title = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
  return title || fallback;
}

/**
 * Find the document titled `title` in this season, or create it. Documents are
 * unique per (org, season, title), so repeated exports of the same Part Studio
 * stack up as versions of one document instead of a pile of near-duplicates.
 */
export async function findOrCreateCadDocument(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    kind?: CadDocumentKind;
    seasonYear?: number;
    description?: string | null;
    externalUrl?: string | null;
  },
): Promise<{ id: string; created: boolean; seasonYear: number }> {
  const seasonYear = input.seasonYear ?? currentSeasonYear();
  const title = cadVaultTitle(input.title);
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM cad_documents WHERE org_id = $1::uuid AND season_year = $2::int AND title = $3 LIMIT 1`,
    [input.orgId, seasonYear, title],
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false, seasonYear };
  const externalUrl = input.externalUrl && input.externalUrl.startsWith("https://") ? input.externalUrl.slice(0, 500) : null;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO cad_documents(org_id, season_year, title, description, kind, external_url, created_by)
     VALUES ($1::uuid, $2::int, $3, $4, $5, $6, $7)
     RETURNING id`,
    [input.orgId, seasonYear, title, input.description?.slice(0, 2000) ?? null, input.kind ?? "part", externalUrl, input.userId],
  );
  return { id: inserted.rows[0]!.id, created: true, seasonYear };
}

/** Deep link into the vault UI for one document. */
export function cadVaultDocumentHref(orgId: string, documentId: string): string {
  return `/cad-vault?orgId=${encodeURIComponent(orgId)}&document=${encodeURIComponent(documentId)}`;
}

export type SavedExport = {
  documentId: string;
  version: number;
  publicId: string;
  duplicate: boolean;
  href: string;
  title: string;
  createdDocument: boolean;
};

/**
 * Onshape export → vault: find-or-create the document (kind "part", titled from
 * the element name) and store the bytes as its next version. Used by the agent's
 * onshape_export_* tools and the legacy job pipeline's export steps.
 */
export async function saveExportToCadVault(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    filename: string;
    bytes: Buffer;
    changeNote: string | null;
    kind?: CadDocumentKind;
    externalUrl?: string | null;
  },
): Promise<SavedExport> {
  const file = await prepareCadVaultFile(input.bytes, input.filename);
  const document = await findOrCreateCadDocument(client, {
    orgId: input.orgId,
    userId: input.userId,
    title: input.title,
    kind: input.kind ?? "part",
    description: "Exported from Onshape by the Vantage CAD agent.",
    externalUrl: input.externalUrl ?? null,
  });
  const stored = await storeCadVaultVersion(client, {
    orgId: input.orgId,
    userId: input.userId,
    documentId: document.id,
    file,
    changeNote: input.changeNote,
  });
  return {
    documentId: document.id,
    version: stored.version,
    publicId: stored.publicId,
    duplicate: stored.duplicate,
    href: cadVaultDocumentHref(input.orgId, document.id),
    title: cadVaultTitle(input.title),
    createdDocument: document.created,
  };
}
