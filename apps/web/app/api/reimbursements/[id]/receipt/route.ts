import { createHash } from "node:crypto";
import { withRls } from "@vantage/db";
import {
  auditPayload,
  evaluateReceiptUpload,
  isUuid,
  MAX_RECEIPT_BYTES,
  writeReimbursementAudit,
} from "../../../../../lib/finance/reimbursements";
import {
  requireOrgMember,
  requireTenantSession,
  TenantHttpError,
  tenantErrorResponse,
} from "../../../../../lib/tenant-org-access";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Serve a receipt photo. RLS scopes reimbursement_requests to the filer and the
 * org's owners/admins (0482), so a claim belonging to someone else simply is not
 * found — 404, never 403, so ids stay unprobeable. Bytes are served no-store
 * with a locked-down CSP: a receipt is a private financial document.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireTenantSession().catch(() => null);
  if (!session) return new Response(null, { status: 404 });
  const { id } = await params;
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!isUuid(id) || !isUuid(orgId)) return new Response(null, { status: 404 });

  try {
    const result = await withRls({ userId: session.user.id, orgId }, (client) =>
      client.query<{ mediaType: string; bytes: Uint8Array; filename: string | null }>(
        `SELECT receipt_media_type AS "mediaType", receipt_bytes AS bytes, receipt_filename AS filename
         FROM reimbursement_requests
         WHERE org_id = $1::uuid AND id = $2::uuid AND receipt_bytes IS NOT NULL`,
        [orgId, id],
      ),
    );
    const row = result.rows[0];
    if (!row) return new Response(null, { status: 404 });
    const body = new ArrayBuffer(row.bytes.byteLength);
    new Uint8Array(body).set(row.bytes);
    const filename = (row.filename ?? "receipt").replace(/["\\\r\n]/g, "");
    return new Response(body, {
      headers: {
        "content-type": row.mediaType,
        "content-length": String(row.bytes.byteLength),
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

/**
 * Attach (or replace) the receipt photo. The client downscales the phone camera
 * shot first — see lib/scouting/media-downscale.ts — so the cap is a backstop,
 * not the normal path. Only the filer may attach, and only while the claim is
 * still theirs to change; once approved the evidence is frozen.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireTenantSession().catch(() => null);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Reimbursement not found." }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Upload a receipt photo as multipart form data." }, { status: 400 });
  }
  const orgId = form.get("orgId");
  if (typeof orgId !== "string" || !isUuid(orgId)) {
    return Response.json({ error: "orgId is required" }, { status: 400 });
  }
  const file = form.get("receipt");
  if (!(file instanceof File)) return Response.json({ error: "No receipt photo was attached." }, { status: 400 });
  // Check the declared size before reading the body into memory.
  if (file.size > MAX_RECEIPT_BYTES) {
    const verdict = evaluateReceiptUpload({ mediaType: file.type, byteSize: file.size });
    return Response.json({ error: verdict.ok ? "That photo is too large." : verdict.reason }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const verdict = evaluateReceiptUpload({ mediaType: file.type, byteSize: bytes.length });
  if (!verdict.ok) return Response.json({ error: verdict.reason }, { status: 400 });
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const filename = (file.name || "receipt").slice(0, 200);

  try {
    const saved = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await requireOrgMember(client, orgId, session.user.id);
      const claim = await client.query<{ memberUserId: string; status: string; amountUsd: string }>(
        `SELECT member_user_id::text AS "memberUserId", status, amount_usd::text AS "amountUsd"
         FROM reimbursement_requests WHERE org_id = $1::uuid AND id = $2::uuid`,
        [orgId, id],
      );
      const row = claim.rows[0];
      if (!row) throw new TenantHttpError(404, "Reimbursement not found.");
      if (row.memberUserId !== session.user.id && !member.admin) {
        throw new TenantHttpError(403, "You can only attach receipts to reimbursements you filed.");
      }
      if (row.status === "approved" || row.status === "paid") {
        throw new TenantHttpError(409, "This reimbursement is already decided — its receipt is locked.");
      }
      const updated = await client.query(
        `UPDATE reimbursement_requests
         SET receipt_bytes = $3, receipt_byte_size = $4::int, receipt_media_type = $5,
             receipt_checksum_sha256 = $6, receipt_filename = $7, updated_at = now()
         WHERE org_id = $1::uuid AND id = $2::uuid`,
        [orgId, id, bytes, bytes.length, verdict.mediaType, checksum, filename],
      );
      if (!updated.rowCount) throw new TenantHttpError(403, "You do not have permission to change that.");
      await writeReimbursementAudit(client, {
        orgId,
        actorUserId: session.user.id,
        action: "reimbursement.receipt_attached",
        before: null,
        after: auditPayload({
          reimbursementId: id,
          status: row.status === "submitted" ? "submitted" : "draft",
          amountUsd: Number(row.amountUsd ?? 0),
        }),
      });
      return { byteSize: bytes.length, checksum };
    });
    return Response.json({ success: true, ...saved });
  } catch (error) {
    return tenantErrorResponse(error, "Could not attach that receipt.");
  }
}
