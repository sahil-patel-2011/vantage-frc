import { createHash } from "node:crypto";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import type { PoolClient } from "@neondatabase/serverless";
import { detectCadFormat } from "../../../../../lib/cad-vault/format-detect";
import { cadStorageKey, safeCadFilename } from "../../../../../lib/cad-vault/filenames";
import { evaluateCadQuota, fetchCadUsage, MAX_CAD_FILE_BYTES } from "../../../../../lib/cad-vault/quota";
import { StlTooLargeError, computeStlGeometry, type StlGeometrySummary } from "../../../../../lib/cad-vault/stl-geometry";
import { renderStlThumbnail } from "../../../../../lib/cad-vault/stl-thumbnail";

export const runtime = "nodejs";
export const maxDuration = 60;

type VersionResult = {
  duplicate: boolean;
  publicId: string;
  version: number;
  filename: string;
  format: string;
};

/**
 * Lock the document row (serializes concurrent uploads on current_version),
 * verify tenancy, and return the locked state.
 */
async function lockDocument(client: PoolClient, documentId: string, orgId: string) {
  const document = await client.query<{ id: string; currentVersion: number }>(
    `SELECT id, current_version AS "currentVersion" FROM cad_documents
     WHERE id = $1::uuid AND org_id = $2::uuid FOR UPDATE`,
    [documentId, orgId],
  );
  return document.rows[0] ?? null;
}

async function insertVersion(
  client: PoolClient,
  input: {
    orgId: string;
    documentId: string;
    version: number;
    filename: string;
    format: string;
    mediaType: string;
    bytes: Buffer;
    checksum: string;
    geometry: StlGeometrySummary | Record<string, never>;
    thumbnail: Buffer | null;
    changeNote: string | null;
    userId: string;
  },
): Promise<VersionResult> {
  const storageKey = cadStorageKey(input.orgId, input.documentId, input.version, input.filename);
  const inserted = await client.query<{ publicId: string }>(
    `INSERT INTO cad_document_versions
       (org_id, document_id, version, filename, format, media_type, bytes, byte_size,
        checksum_sha256, storage_key, geometry, thumbnail_png, change_note, uploaded_by)
     VALUES ($1::uuid, $2::uuid, $3::int, $4, $5, $6, $7, $8::int, $9, $10, $11::jsonb, $12, $13, $14)
     RETURNING public_id AS "publicId"`,
    [
      input.orgId,
      input.documentId,
      input.version,
      input.filename,
      input.format,
      input.mediaType,
      input.bytes,
      input.bytes.length,
      input.checksum,
      storageKey,
      JSON.stringify(input.geometry),
      input.thumbnail,
      input.changeNote,
      input.userId,
    ],
  );
  await client.query(
    `UPDATE cad_documents SET current_version = $3::int, updated_by = $4, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.documentId, input.orgId, input.version, input.userId],
  );
  return {
    duplicate: false,
    publicId: inserted.rows[0]!.publicId,
    version: input.version,
    filename: input.filename,
    format: input.format,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { documentId } = await params;
  const userId = session.user.id;

  const contentType = request.headers.get("content-type") ?? "";

  // JSON body = "Restore as new version": server-side copy of an existing
  // version's bytes, no re-upload from the client.
  if (contentType.includes("application/json")) {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
    const restoreFromVersion = Number(body.restoreFromVersion);
    if (!orgId || !Number.isInteger(restoreFromVersion) || restoreFromVersion < 1) {
      return Response.json({ error: "orgId and restoreFromVersion are required" }, { status: 400 });
    }
    try {
      const result = await withRls({ userId, orgId }, async (client) => {
        const document = await lockDocument(client, documentId, orgId);
        if (!document) throw new Error("Document not found in this team.");
        const source = await client.query<{ byteSize: number }>(
          `SELECT byte_size AS "byteSize" FROM cad_document_versions
           WHERE org_id = $1::uuid AND document_id = $2::uuid AND version = $3::int`,
          [orgId, documentId, restoreFromVersion],
        );
        if (!source.rows[0]) throw new Error(`Version ${restoreFromVersion} does not exist on this document.`);
        const usage = await fetchCadUsage(client, orgId, documentId);
        const verdict = evaluateCadQuota(Number(source.rows[0].byteSize), usage);
        if (!verdict.ok) throw new Error(verdict.reason);
        const nextVersion = document.currentVersion + 1;
        const restored = await client.query<{ publicId: string; filename: string; format: string }>(
          `INSERT INTO cad_document_versions
             (org_id, document_id, version, filename, format, media_type, bytes, byte_size,
              checksum_sha256, storage_key, geometry, thumbnail_png, change_note, uploaded_by)
           SELECT org_id, document_id, $4::int, filename, format, media_type, bytes, byte_size,
                  checksum_sha256,
                  $1::uuid || '/cad-vault/' || $2::uuid || '/v' || $4::int || '/' || filename,
                  geometry, thumbnail_png, $5, $6
           FROM cad_document_versions
           WHERE org_id = $1::uuid AND document_id = $2::uuid AND version = $3::int
           RETURNING public_id AS "publicId", filename, format`,
          [orgId, documentId, restoreFromVersion, nextVersion, `Restored from v${restoreFromVersion}`, userId],
        );
        await client.query(
          `UPDATE cad_documents SET current_version = $3::int, updated_by = $4, updated_at = now()
           WHERE id = $1::uuid AND org_id = $2::uuid`,
          [documentId, orgId, nextVersion, userId],
        );
        const row = restored.rows[0]!;
        return { duplicate: false, publicId: row.publicId, version: nextVersion, filename: row.filename, format: row.format } satisfies VersionResult;
      });
      return Response.json(result, { status: 201 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not restore that version" }, { status: 400 });
    }
  }

  // Multipart body = fresh upload.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a multipart upload with a file field" }, { status: 400 });
  }
  const orgIdRaw = form.get("orgId");
  const orgId = typeof orgIdRaw === "string" ? orgIdRaw.trim() : "";
  const changeNoteRaw = form.get("changeNote");
  const changeNote = typeof changeNoteRaw === "string" && changeNoteRaw.trim() ? changeNoteRaw.trim().slice(0, 500) : null;
  const file = form.get("file");
  if (!orgId || !(file instanceof File)) return Response.json({ error: "orgId and a file are required" }, { status: 400 });
  if (file.size <= 0) return Response.json({ error: "The file is empty." }, { status: 400 });
  if (file.size > MAX_CAD_FILE_BYTES) {
    return Response.json(
      { error: `This file is ${Math.round(file.size / (1024 * 1024))} MB; the per-file limit is 50 MB. Export a lighter mesh or split the assembly.` },
      { status: 400 },
    );
  }

  const raw = Buffer.from(await file.arrayBuffer());
  const filename = safeCadFilename(file.name);
  const detection = detectCadFormat(raw, filename);
  if (!detection.ok) return Response.json({ error: detection.reason }, { status: 400 });
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
      if (error instanceof StlTooLargeError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      geometry = {}; // parse failed after detection: store the file, no summary
    }
  }

  try {
    const result = await withRls({ userId, orgId }, async (client) => {
      const document = await lockDocument(client, documentId, orgId);
      if (!document) throw new Error("Document not found in this team.");
      const duplicate = await client.query<{ publicId: string; version: number; filename: string; format: string }>(
        `SELECT public_id AS "publicId", version, filename, format FROM cad_document_versions
         WHERE org_id = $1::uuid AND document_id = $2::uuid AND checksum_sha256 = $3
         ORDER BY version DESC LIMIT 1`,
        [orgId, documentId, checksum],
      );
      if (duplicate.rows[0]) {
        const row = duplicate.rows[0];
        return { duplicate: true, publicId: row.publicId, version: Number(row.version), filename: row.filename, format: row.format } satisfies VersionResult;
      }
      const usage = await fetchCadUsage(client, orgId, documentId);
      const verdict = evaluateCadQuota(raw.length, usage);
      if (!verdict.ok) throw new Error(verdict.reason);
      return insertVersion(client, {
        orgId,
        documentId,
        version: document.currentVersion + 1,
        filename,
        format: detection.format,
        mediaType: detection.mediaType,
        bytes: raw,
        checksum,
        geometry,
        thumbnail,
        changeNote,
        userId,
      });
    });
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not store the file" }, { status: 400 });
  }
}
