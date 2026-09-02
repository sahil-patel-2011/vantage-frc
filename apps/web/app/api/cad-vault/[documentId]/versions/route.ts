import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { evaluateCadQuota, fetchCadUsage, MAX_CAD_FILE_BYTES } from "../../../../../lib/cad-vault/quota";
import {
  lockCadDocument,
  prepareCadVaultFile,
  storeCadVaultVersion,
  type StoredCadVersion,
} from "../../../../../lib/cad-vault/store-version";

export const runtime = "nodejs";
export const maxDuration = 60;

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
        const document = await lockCadDocument(client, documentId, orgId);
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
        return { duplicate: false, publicId: row.publicId, version: nextVersion, filename: row.filename, format: row.format } satisfies StoredCadVersion;
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

  // Format detection, sha256, STL geometry + thumbnail — the same preparation
  // the Onshape export path runs, so both kinds of version look identical.
  let prepared;
  try {
    prepared = await prepareCadVaultFile(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read the file" }, { status: 400 });
  }

  try {
    const result = await withRls({ userId, orgId }, (client) =>
      storeCadVaultVersion(client, { orgId, userId, documentId, file: prepared, changeNote }),
    );
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not store the file" }, { status: 400 });
  }
}
