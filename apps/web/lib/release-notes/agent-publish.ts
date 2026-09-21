import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import type { PoolClient } from "@neondatabase/serverless";
import {
  composeReleaseNotes,
  createProductRelease,
  getProductRelease,
  publishProductRelease,
  updateProductRelease,
  type ComposeReleaseNotesInput,
  type ProductRelease,
} from "@vantage/core";

/**
 * Machine publishing path for release notes. A coding agent (Cursor, Claude
 * Code, CI) holds RELEASE_AGENT_TOKEN and posts the raw facts; the composer
 * decides the wording and shape, so every note reads the same. The human admin
 * console (/api/admin/releases) stays the only way to change audience, plans,
 * or feature flags — this route always publishes to everyone.
 */

export function assertReleaseAgentAuthorized(request: Request): Response | null {
  const secret = process.env.RELEASE_AGENT_TOKEN?.trim();
  if (!secret) {
    return Response.json({ error: "RELEASE_AGENT_TOKEN is not configured" }, { status: 503 });
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const header = request.headers.get("x-release-agent-token")?.trim();
  if (bearer === secret || header === secret) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function releasePool() {
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) throw new Error("DATABASE_URL is required to publish release notes");
  return createSqlPool(connectionString);
}

async function withReleaseClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = releasePool();
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
    await pool.end();
  }
}

/** Releases are attributed to the founding platform admin, never to the token. */
async function resolveActor(client: PoolClient): Promise<string | null> {
  const result = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM platform_admins ORDER BY granted_at ASC LIMIT 1`,
  );
  return result.rows[0]?.userId ?? null;
}

export type PublicRelease = {
  slug: string;
  title: string;
  versionLabel: string | null;
  notesMarkdown: string;
  publishedAt: string | null;
};

/**
 * Public update feed: published releases aimed at everyone. Powers the desktop
 * app's "what's new" panel and the marketing changelog, so neither needs a
 * session.
 */
export async function listPublicReleases(limit = 20): Promise<PublicRelease[]> {
  return withReleaseClient(async (client) => {
    const result = await client.query<PublicRelease>(
      `SELECT slug, title, version_label AS "versionLabel",
              notes_markdown AS "notesMarkdown",
              published_at AS "publishedAt"
       FROM product_releases
       WHERE status = 'published' AND audience_type = 'all' AND min_plan IS NULL
       ORDER BY published_at DESC NULLS LAST, created_at DESC
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 50)],
    );
    return result.rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
    }));
  });
}

export type AgentPublishResult = {
  release: ProductRelease;
  created: boolean;
  headline: string;
};

/** Compose, upsert by version slug, then publish + notify. Idempotent per version. */
export async function publishReleaseFromAgent(
  input: ComposeReleaseNotesInput & { draft?: boolean },
): Promise<AgentPublishResult> {
  const composed = composeReleaseNotes(input);

  return withReleaseClient(async (client) => {
    const actorUserId = await resolveActor(client);
    if (!actorUserId) throw new Error("No platform admin exists yet to attribute the release to");

    const existing = await getProductRelease(client, composed.slug);
    const payload = {
      slug: composed.slug,
      title: composed.title,
      versionLabel: composed.versionLabel,
      notesMarkdown: composed.notesMarkdown,
      audienceType: "all" as const,
      status: (input.draft ? "draft" : "published") as "draft" | "published",
      notifyEmail: false,
      notifyInApp: true,
    };

    let release = existing
      ? await updateProductRelease(client, existing.id, payload, actorUserId)
      : await createProductRelease(client, payload, actorUserId);

    if (!input.draft) {
      // Re-running the same version edits the note in place without re-notifying.
      const notify = existing?.status !== "published";
      const published = await publishProductRelease(client, release.id, actorUserId, { notify });
      release = published.release;
    }

    return { release, created: !existing, headline: composed.headline };
  });
}
