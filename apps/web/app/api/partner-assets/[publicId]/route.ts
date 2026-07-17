import { requestPool } from "@vantage/db";

export async function GET(_request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  try {
    const asset = await requestPool.query<{ media_type: string; bytes: Uint8Array }>(
      "SELECT media_type, bytes FROM get_public_partner_asset($1::uuid)", [publicId],
    );
    const image = asset.rows[0];
    if (!image) return new Response(null, { status: 404 });
    const body = new ArrayBuffer(image.bytes.byteLength);
    new Uint8Array(body).set(image.bytes);
    return new Response(body, { headers: { "content-type": image.media_type, "cache-control": "public, max-age=60", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
