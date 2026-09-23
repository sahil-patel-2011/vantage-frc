import { loadPublishedDesktopRelease } from "../../../../lib/desktop/release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public desktop updater manifest. No session: it only restates the GitHub
 * `latest.json` already published on a `desktop-v*` tag, after the download
 * host allowlist. 503 when nothing is published — the shell then asks GitHub
 * directly.
 */
export async function GET() {
  const result = await loadPublishedDesktopRelease();
  if (!result.ok) {
    return Response.json(result.body, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  return Response.json(result.release, {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
