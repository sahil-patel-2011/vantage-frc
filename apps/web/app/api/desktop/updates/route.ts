import { listPublicReleases } from "../../../../lib/release-notes/agent-publish";

export const runtime = "nodejs";

/**
 * Public update feed for the desktop app and the marketing changelog. No
 * session: it only ever returns releases already published to everyone.
 * `latest` is what the desktop updater compares against its own build.
 */
export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  try {
    const releases = await listPublicReleases(Number.isFinite(limit) ? limit : 20);
    return Response.json(
      {
        latest: releases[0]
          ? { version: releases[0].versionLabel, slug: releases[0].slug, publishedAt: releases[0].publishedAt }
          : null,
        releases,
      },
      { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Update feed unavailable" },
      { status: 503 },
    );
  }
}
