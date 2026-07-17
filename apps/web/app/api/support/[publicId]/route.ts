import { requestPool } from "@vantage/db";

function validUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try { const parsed = new URL(value.trim()); return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null; } catch { return null; }
}
function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
const attempts = new Map<string, { count: number; resetAt: number }>();
function rateLimited(request: Request, publicId: string) {
  const key = `${publicId}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`;
  const now = Date.now(); const current = attempts.get(key);
  if (!current || current.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + 3_600_000 }); return false; }
  current.count += 1; return current.count > 5;
}

export async function GET(_request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  try {
    const result = await requestPool.query<{ storefront: unknown }>("SELECT get_public_partner_storefront($1::uuid) AS storefront", [publicId]);
    if (!result.rows[0]?.storefront) return Response.json({ error: "This team support page is unavailable." }, { status: 404 });
    return Response.json(result.rows[0].storefront, { headers: { "cache-control": "public, max-age=60" } });
  } catch { return Response.json({ error: "This team support page is unavailable." }, { status: 404 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  if (text(body.companyWebsite, 100) || text(body.websiteField, 100)) return Response.json({ ok: true }, { status: 202 });
  if (rateLimited(request, publicId)) return Response.json({ error: "Please wait before sending another request." }, { status: 429 });
  if (text(body.companyName, 160).length < 2 || text(body.contactName, 160).length < 2 || !/^\S+@\S+\.\S+$/.test(text(body.contactEmail, 320))) return Response.json({ error: "Please provide a company, contact, and valid email." }, { status: 400 });
  try {
    await requestPool.query("SELECT create_public_partner_submission($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9)", [publicId, text(body.packageId, 64) || null, text(body.companyName, 160), text(body.contactName, 160), text(body.contactEmail, 320), validUrl(body.website), text(body.headline, 240) || null, text(body.message, 4000) || null, validUrl(body.externalLogoUrl ?? body.logoUrl)]);
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "This support page is unavailable or that package has changed." }, { status: 400 }); }
}
