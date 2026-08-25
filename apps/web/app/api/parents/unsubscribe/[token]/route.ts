import { requestPool } from "@vantage/db";
import { PARENT_TOKEN_PATTERN } from "../../../../../lib/parent-comms/tokens";

/**
 * One-click parent digest unsubscribe. Parents have no Vantage account, so the
 * users-table /unsubscribe page cannot serve them: this route authenticates
 * solely by the opaque unsubscribe_token from parent_contacts (allow-listed in
 * proxy.ts by narrow regex).
 *
 * GET renders a tiny confirmation page (never mutates — mail scanners prefetch
 * GET links); the page's form POSTs back here, which flips digest_opt_in off
 * via the SECURITY DEFINER parent_digest_unsubscribe function. Unknown tokens
 * -> 404; repeat clicks stay unsubscribed and still succeed.
 */
export const dynamic = "force-dynamic";

const PAGE_STYLE =
  "margin:0;padding:48px 16px;font-family:system-ui,-apple-system,sans-serif;" +
  "background:#f5f5f4;color:#1c1917;display:flex;justify-content:center";
const CARD_STYLE =
  "max-width:420px;width:100%;background:#fff;border:1px solid #e7e5e4;" +
  "border-radius:12px;padding:24px;text-align:center";
const BUTTON_STYLE =
  "display:inline-block;min-height:44px;padding:12px 24px;border-radius:8px;" +
  "border:none;background:#1c1917;color:#fff;font-size:15px;cursor:pointer";

function page(body: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />` +
      `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
      `<meta name="robots" content="noindex" /><title>Parent updates</title></head>` +
      `<body style="${PAGE_STYLE}"><main style="${CARD_STYLE}">${body}</main></body></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function notFound(): Response {
  return page(
    `<h1 style="font-size:20px">Link not found</h1>` +
      `<p>This unsubscribe link is not valid. It may have been removed by the team.</p>`,
    404,
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!PARENT_TOKEN_PATTERN.test(token)) return notFound();
  // No lookup on GET: the page confirms intent without revealing whether the
  // token exists (and without mutating on a prefetch).
  return page(
    `<h1 style="font-size:20px">Stop parent update emails?</h1>` +
      `<p>You will no longer receive the team's weekly parent digest at this address.</p>` +
      `<form method="post"><button type="submit" style="${BUTTON_STYLE}">Unsubscribe</button></form>`,
    200,
  );
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!PARENT_TOKEN_PATTERN.test(token)) return notFound();
  try {
    const result = await requestPool.query<{ out: { orgName?: string } | null }>(
      "SELECT parent_digest_unsubscribe($1) AS out",
      [token],
    );
    const out = result.rows[0]?.out;
    if (!out) return notFound();
    const orgName = escapeHtml(out.orgName ?? "your team");
    return page(
      `<h1 style="font-size:20px">You're unsubscribed</h1>` +
        `<p>${orgName} will no longer email you the weekly parent digest. ` +
        `If this was a mistake, ask a team mentor to turn the digest back on for you.</p>`,
      200,
    );
  } catch {
    return page(
      `<h1 style="font-size:20px">Something went wrong</h1>` +
        `<p>We could not process this unsubscribe right now. Please try again later.</p>`,
      500,
    );
  }
}
