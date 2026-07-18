import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  applyKnowledgeTemplate,
  applyKnowledgeWikiAction,
  loadKnowledgeWikiView,
  parseKnowledgeWikiAction,
  slugifyTitle,
  type KnowledgeWikiAction,
} from "../../../../lib/knowledge";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Wiki request failed" }, { status });
}

async function resolveOrgId(client: PoolClient, userId: string, requested: string | null) {
  const membership = await client.query<{ orgId: string }>(
    `SELECT m.org_id AS "orgId"
     FROM memberships m JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requested],
  );
  return membership.rows[0]?.orgId ?? null;
}

async function uniqueSlug(client: PoolClient, orgId: string, title: string, excludeId: string | null) {
  const base = slugifyTitle(title);
  for (let i = 0; i < 40; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`.slice(0, 120);
    const clash = await client.query(
      `SELECT 1 FROM knowledge_pages WHERE org_id = $1::uuid AND slug = $2 AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1`,
      [orgId, candidate, excludeId],
    );
    if (!clash.rowCount) return candidate;
  }
  throw new HttpError(409, "Could not allocate a unique page slug");
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const pageId = url.searchParams.get("pageId");
    const pageSlug = url.searchParams.get("page");
    const q = url.searchParams.get("q");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const orgId = await resolveOrgId(client, session.user.id, requestedOrg);
      if (!orgId) {
        return {
          status: "setup_required" as const,
          orgId: "",
          message: "Join a team workspace to use the knowledge base.",
        };
      }
      return loadKnowledgeWikiView(client, {
        orgId,
        userId: session.user.id,
        pageId,
        pageSlug,
        q,
      });
    });
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const parsed = parseKnowledgeWikiAction(await request.json());

    const view = await withRls({ userId: session.user.id, orgId: parsed.orgId }, async (client) => {
      let action: KnowledgeWikiAction = parsed;

      if (action.action === "upsert_page") {
        const member = await client.query<{ teamNumber: number | null }>(
          `SELECT o.team_number AS "teamNumber"
           FROM memberships m JOIN organizations o ON o.id = m.org_id
           WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid`,
          [action.orgId, session.user.id],
        );
        if (!member.rowCount) throw new HttpError(403, "Organization membership required");

        let title = action.title;
        let body = action.body;
        let tags = action.tags;
        let templateKind = action.templateKind;
        if (action.fromTemplate) {
          const applied = applyKnowledgeTemplate(action.fromTemplate, member.rows[0]!.teamNumber);
          title = title || applied.title;
          body = body || applied.body;
          tags = tags.length ? tags : applied.tags;
          templateKind = applied.templateKind;
        }
        if (!title.trim()) throw new HttpError(400, "Title is required");
        const slug = action.slug || (await uniqueSlug(client, action.orgId, title, action.id));
        action = { ...action, title, body, tags, templateKind, slug, fromTemplate: null };
      }

      await applyKnowledgeWikiAction(client, session.user.id, action);

      const pageId =
        action.action === "upsert_page"
          ? action.id
          : action.action === "link"
            ? action.pageId
            : null;
      const pageSlug =
        action.action === "upsert_page" && !action.id ? action.slug : null;

      return loadKnowledgeWikiView(client, {
        orgId: parsed.orgId,
        userId: session.user.id,
        pageId,
        pageSlug,
      });
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
