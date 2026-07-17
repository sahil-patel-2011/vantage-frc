import { createHash } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import sharp from "sharp";
import { MAX_SPONSOR_NORMALIZED_BYTES, MAX_SPONSOR_UPLOAD_BYTES, safeSponsorFilename, sponsorImageKind } from "../../../../lib/sponsor-assets";

function value(form: FormData, name: string) {
  const raw = form.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

async function requireAdmin(client: PoolClient, orgId: string, userId: string) {
  const membership = await client.query<{ role: string }>("SELECT role::text AS role FROM memberships WHERE org_id = $1 AND user_id = $2", [orgId, userId]);
  if (!membership.rows[0] || !["owner", "admin"].includes(membership.rows[0].role)) throw new Error("A team owner or admin must manage sponsor artwork");
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const form = await request.formData();
  const orgId = value(form, "orgId");
  const sponsorId = value(form, "sponsorId");
  const file = form.get("file");
  if (!orgId || !sponsorId || !(file instanceof File)) return Response.json({ error: "orgId, sponsorId, and an image file are required" }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_SPONSOR_UPLOAD_BYTES) return Response.json({ error: "Artwork must be between 1 byte and 4 MB" }, { status: 400 });

  const raw = Buffer.from(await file.arrayBuffer());
  if (!sponsorImageKind(raw)) return Response.json({ error: "Upload a PNG, JPEG, or WebP image—not SVG or another file type." }, { status: 400 });

  let normalized: Buffer;
  let width: number;
  let height: number;
  try {
    const result = await sharp(raw, { limitInputPixels: 12_000_000, animated: false })
      .rotate()
      .resize({ width: 800, height: 400, fit: "inside", withoutEnlargement: true })
      .png({ palette: true, quality: 90, compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    normalized = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch {
    return Response.json({ error: "That image could not be processed safely." }, { status: 400 });
  }
  if (normalized.length > MAX_SPONSOR_NORMALIZED_BYTES) return Response.json({ error: "Artwork is still too detailed after optimization. Use a simpler logo under 1 MB." }, { status: 400 });
  const checksum = createHash("sha256").update(normalized).digest("hex");

  try {
    const asset = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireAdmin(client, orgId, session.user.id);
      const sponsor = await client.query("SELECT id FROM sponsors WHERE id = $1 AND org_id = $2", [sponsorId, orgId]);
      if (!sponsor.rows[0]) throw new Error("Sponsor not found in this team");
      const duplicate = await client.query<{ id: string; publicId: string; status: string; filename: string; width: number; height: number }>(
        `SELECT id, public_id AS "publicId", status, name AS filename, width, height FROM sponsor_assets
         WHERE org_id = $1 AND sponsor_id = $2 AND checksum_sha256 = $3`, [orgId, sponsorId, checksum],
      );
      if (duplicate.rows[0]) return { ...duplicate.rows[0], duplicate: true };
      const usage = await client.query<{ count: string; bytes: string }>(
        "SELECT COUNT(*)::text AS count, COALESCE(SUM(byte_size), 0)::text AS bytes FROM sponsor_assets WHERE org_id = $1", [orgId],
      );
      if (Number(usage.rows[0]?.count ?? 0) >= 100 || Number(usage.rows[0]?.bytes ?? 0) + normalized.length > 25 * 1024 * 1024) {
        throw new Error("Sponsor asset library limit reached (100 images or 25 MB). Archive unused artwork first.");
      }
      const inserted = await client.query<{ id: string; publicId: string; status: string; filename: string; width: number; height: number }>(
        `INSERT INTO sponsor_assets(org_id, sponsor_id, name, bytes, byte_size, width, height, checksum_sha256, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, public_id AS "publicId", status, name AS filename, width, height`,
        [orgId, sponsorId, safeSponsorFilename(file.name), normalized, normalized.length, width, height, checksum, session.user.id],
      );
      await client.query(
        `INSERT INTO team_business_audit_events(org_id, actor_user_id, action, entity_type, entity_id, metadata)
         VALUES ($1,$2,'upload-sponsor-artwork','sponsor_asset',$3,$4::jsonb)`,
        [orgId, session.user.id, inserted.rows[0]!.id, JSON.stringify({ sponsorId, width, height, bytes: normalized.length })],
      );
      return { ...inserted.rows[0]!, duplicate: false };
    });
    return Response.json(asset, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not upload artwork" }, { status: 400 });
  }
}
