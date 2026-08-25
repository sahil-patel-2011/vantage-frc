import { createHash } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import sharp from "sharp";
import {
  MAX_LOGO_EDGE,
  MAX_LOGO_STORED_BYTES,
  MAX_LOGO_UPLOAD_BYTES,
} from "../../../../lib/branding/branding";
import { sponsorImageKind } from "../../../../lib/sponsor-assets";

export const dynamic = "force-dynamic";

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

async function requireMember(client: PoolClient, orgId: string, userId: string) {
  const membership = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, userId],
  );
  const role = membership.rows[0]?.role;
  if (!role) throw new Error("Organization access denied");
  return role;
}

function requireAdminRole(role: string) {
  if (role !== "owner" && role !== "admin") {
    throw new Error("A team owner or admin manages the team logo");
  }
}

/** Serves the stored PNG to signed-in members of that team only. */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return new Response(null, { status: 401 });
  }
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return new Response(null, { status: 400 });

  try {
    const logo = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireMember(client, orgId, session.user.id);
      const result = await client.query<{ bytes: Uint8Array; mediaType: string; checksum: string }>(
        `SELECT logo_bytes AS bytes, logo_media_type AS "mediaType", logo_checksum_sha256 AS checksum
         FROM org_branding
         WHERE org_id = $1::uuid AND logo_bytes IS NOT NULL`,
        [orgId],
      );
      return result.rows[0] ?? null;
    });
    if (!logo) return new Response(null, { status: 404 });

    const body = new ArrayBuffer(logo.bytes.byteLength);
    new Uint8Array(body).set(logo.bytes);
    return new Response(body, {
      headers: {
        "content-type": logo.mediaType,
        // Team-private artwork: never a shared cache, but revalidation is cheap
        // because the URL carries the checksum as `v`.
        "cache-control": "private, max-age=300",
        etag: `"${logo.checksum}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const orgIdRaw = form?.get("orgId");
  const orgId = typeof orgIdRaw === "string" ? orgIdRaw.trim() : "";
  const file = form?.get("file");
  if (!orgId || !(file instanceof File)) {
    return Response.json({ error: "orgId and an image file are required" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_LOGO_UPLOAD_BYTES) {
    return Response.json({ error: "Logo must be between 1 byte and 2 MB." }, { status: 400 });
  }

  const raw = Buffer.from(await file.arrayBuffer());
  // Sniff the real bytes — the browser-declared content type is not evidence.
  if (!sponsorImageKind(raw)) {
    return Response.json(
      { error: "Upload a PNG, JPEG, or WebP image — not SVG or another file type." },
      { status: 400 },
    );
  }

  let normalized: Buffer;
  let width: number;
  let height: number;
  try {
    const result = await sharp(raw, { limitInputPixels: 12_000_000, animated: false })
      .rotate()
      .resize({ width: MAX_LOGO_EDGE, height: MAX_LOGO_EDGE, fit: "inside", withoutEnlargement: true })
      .png({ palette: true, quality: 90, compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    normalized = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch {
    return Response.json({ error: "That image could not be processed safely." }, { status: 400 });
  }

  if (normalized.length > MAX_LOGO_STORED_BYTES) {
    return Response.json(
      { error: "Logo is still over 256 KB after optimization. Use a simpler, flatter mark." },
      { status: 400 },
    );
  }
  const checksum = createHash("sha256").update(normalized).digest("hex");

  try {
    const logo = await withRls({ userId: session.user.id, orgId }, async (client) => {
      requireAdminRole(await requireMember(client, orgId, session.user.id));
      await client.query(
        `INSERT INTO org_branding(
           org_id, logo_bytes, logo_media_type, logo_byte_size,
           logo_width, logo_height, logo_checksum_sha256, logo_updated_at, updated_by
         )
         VALUES ($1::uuid, $2, 'image/png', $3, $4, $5, $6, now(), $7::uuid)
         ON CONFLICT (org_id) DO UPDATE SET
           logo_bytes = excluded.logo_bytes,
           logo_media_type = excluded.logo_media_type,
           logo_byte_size = excluded.logo_byte_size,
           logo_width = excluded.logo_width,
           logo_height = excluded.logo_height,
           logo_checksum_sha256 = excluded.logo_checksum_sha256,
           logo_updated_at = now(),
           updated_by = excluded.updated_by,
           updated_at = now()`,
        [orgId, normalized, normalized.length, width, height, checksum, session.user.id],
      );
      return { width, height, byteSize: normalized.length, version: checksum.slice(0, 12) };
    });
    return Response.json({ logo: { present: true, ...logo } }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save the logo" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { orgId?: string } | null;
  const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    await withRls({ userId: session.user.id, orgId }, async (client) => {
      requireAdminRole(await requireMember(client, orgId, session.user.id));
      await client.query(
        `UPDATE org_branding SET
           logo_bytes = NULL,
           logo_media_type = NULL,
           logo_byte_size = NULL,
           logo_width = NULL,
           logo_height = NULL,
           logo_checksum_sha256 = NULL,
           logo_updated_at = NULL,
           updated_by = $2::uuid,
           updated_at = now()
         WHERE org_id = $1::uuid`,
        [orgId, session.user.id],
      );
    });
    return Response.json({
      logo: { present: false, width: null, height: null, byteSize: null, version: null },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not remove the logo" },
      { status: 400 },
    );
  }
}
