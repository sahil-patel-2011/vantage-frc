import type { PoolClient } from "@neondatabase/serverless";
import { knowledgeHitHref, snippetFrom } from "./helpers";
import type {
  KnowledgeLink,
  KnowledgePageDetail,
  KnowledgePageSummary,
  KnowledgeSearchHit,
  KnowledgeTemplateKind,
  KnowledgeWikiAction,
  KnowledgeWikiView,
} from "./types";

type MemberRow = {
  role: string;
  orgName: string;
  teamNumber: number | null;
};

async function requireMember(client: PoolClient, orgId: string, userId: string): Promise<MemberRow> {
  const member = await client.query<MemberRow>(
    `SELECT m.role, o.name AS "orgName", o.team_number AS "teamNumber"
     FROM memberships m JOIN organizations o ON o.id = m.org_id
     WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid`,
    [orgId, userId],
  );
  if (!member.rowCount) throw new Error("Organization access denied");
  return member.rows[0]!;
}

function mapPage(row: {
  id: string;
  slug: string;
  title: string;
  templateKind: string;
  seasonYear: number | null;
  tags: string[] | null;
  pinned: boolean;
  updatedAt: string;
  linkCount: number | string;
}): KnowledgePageSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    templateKind: row.templateKind as KnowledgeTemplateKind,
    seasonYear: row.seasonYear,
    tags: row.tags ?? [],
    pinned: row.pinned,
    updatedAt: row.updatedAt,
    linkCount: Number(row.linkCount ?? 0),
  };
}

export async function listKnowledgePages(client: PoolClient, orgId: string): Promise<KnowledgePageSummary[]> {
  const result = await client.query<{
    id: string;
    slug: string;
    title: string;
    templateKind: string;
    seasonYear: number | null;
    tags: string[] | null;
    pinned: boolean;
    updatedAt: string;
    linkCount: string;
  }>(
    `SELECT p.id, p.slug, p.title, p.template_kind AS "templateKind", p.season_year AS "seasonYear",
            p.tags, p.pinned, p.updated_at AS "updatedAt",
            (SELECT count(*)::int FROM knowledge_links l WHERE l.page_id = p.id AND l.org_id = p.org_id) AS "linkCount"
     FROM knowledge_pages p
     WHERE p.org_id = $1::uuid
     ORDER BY p.pinned DESC, p.updated_at DESC`,
    [orgId],
  );
  return result.rows.map(mapPage);
}

export async function getKnowledgePage(
  client: PoolClient,
  orgId: string,
  opts: { id?: string; slug?: string },
): Promise<KnowledgePageDetail | null> {
  const result = await client.query<{
    id: string;
    slug: string;
    title: string;
    body: string;
    templateKind: string;
    seasonYear: number | null;
    tags: string[] | null;
    pinned: boolean;
    updatedAt: string;
    createdAt: string;
    createdByName: string | null;
    updatedByName: string | null;
    linkCount: string;
  }>(
    `SELECT p.id, p.slug, p.title, p.body, p.template_kind AS "templateKind",
            p.season_year AS "seasonYear", p.tags, p.pinned,
            p.updated_at AS "updatedAt", p.created_at AS "createdAt",
            cu.name AS "createdByName", uu.name AS "updatedByName",
            (SELECT count(*)::int FROM knowledge_links l WHERE l.page_id = p.id AND l.org_id = p.org_id) AS "linkCount"
     FROM knowledge_pages p
     LEFT JOIN users cu ON cu.id = p.created_by
     LEFT JOIN users uu ON uu.id = p.updated_by
     WHERE p.org_id = $1::uuid
       AND ($2::uuid IS NULL OR p.id = $2::uuid)
       AND ($3::text IS NULL OR p.slug = $3::text)
     LIMIT 1`,
    [orgId, opts.id ?? null, opts.slug ?? null],
  );
  const row = result.rows[0];
  if (!row) return null;

  const links = await client.query<{
    id: string;
    targetType: string;
    targetId: string;
    note: string | null;
    createdAt: string;
    decisionTitle: string | null;
    decisionSeason: number | null;
    reviewTitle: string | null;
    reviewSeason: number | null;
  }>(
    `SELECT l.id, l.target_type AS "targetType", l.target_id AS "targetId", l.note,
            l.created_at AS "createdAt",
            d.title AS "decisionTitle", d.season_year AS "decisionSeason",
            r.title AS "reviewTitle", r.season_year AS "reviewSeason"
     FROM knowledge_links l
     LEFT JOIN decision_records d ON l.target_type = 'decision' AND d.id = l.target_id AND d.org_id = l.org_id
     LEFT JOIN design_reviews r ON l.target_type = 'design_review' AND r.id = l.target_id AND r.org_id = l.org_id
     WHERE l.org_id = $1::uuid AND l.page_id = $2::uuid
     ORDER BY l.created_at DESC`,
    [orgId, row.id],
  );

  const mappedLinks: KnowledgeLink[] = links.rows.map((link) => ({
    id: link.id,
    targetType: link.targetType as KnowledgeLink["targetType"],
    targetId: link.targetId,
    targetTitle: link.targetType === "decision" ? link.decisionTitle : link.reviewTitle,
    targetSeasonYear: link.targetType === "decision" ? link.decisionSeason : link.reviewSeason,
    note: link.note,
    createdAt: link.createdAt,
  }));

  return {
    ...mapPage(row),
    body: row.body,
    createdAt: row.createdAt,
    createdByName: row.createdByName,
    updatedByName: row.updatedByName,
    links: mappedLinks,
  };
}

/**
 * Cross-season search: wiki pages + decision_records + design_reviews.
 * Uses Postgres FTS when the query has tokens; falls back to ILIKE for short needles.
 * Returns empty when there is no real data — never invents hits.
 */
export async function searchKnowledgeCorpus(
  client: PoolClient,
  orgId: string,
  query: string,
  limit = 12,
): Promise<KnowledgeSearchHit[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const capped = Math.min(Math.max(limit, 1), 30);
  const hits: KnowledgeSearchHit[] = [];

  const wiki = await client.query<{
    id: string;
    slug: string;
    title: string;
    body: string;
    seasonYear: number | null;
    rank: number;
  }>(
    `SELECT id, slug, title, body, season_year AS "seasonYear",
            ts_rank(
              to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'')),
              plainto_tsquery('english', $2)
            ) AS rank
     FROM knowledge_pages
     WHERE org_id = $1::uuid
       AND (
         to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))
           @@ plainto_tsquery('english', $2)
         OR title ILIKE '%' || $2 || '%'
         OR body ILIKE '%' || $2 || '%'
       )
     ORDER BY rank DESC NULLS LAST, updated_at DESC
     LIMIT $3`,
    [orgId, q, capped],
  );
  for (const row of wiki.rows) {
    hits.push({
      source: "wiki",
      id: row.id,
      title: row.title,
      snippet: snippetFrom(row.body || row.title, q),
      seasonYear: row.seasonYear,
      href: knowledgeHitHref("wiki", row.id, orgId, row.slug),
      rank: Number(row.rank) || 0.1,
    });
  }

  const decisions = await client.query<{
    id: string;
    title: string;
    seasonYear: number;
    context: string | null;
    decision: string | null;
    rationale: string | null;
    rank: number;
  }>(
    `SELECT id, title, season_year AS "seasonYear", context, decision, rationale,
            ts_rank(
              to_tsvector('english', coalesce(title,'') || ' ' || coalesce(context,'') || ' ' ||
                coalesce(decision,'') || ' ' || coalesce(rationale,'') || ' ' || coalesce(notes,'')),
              plainto_tsquery('english', $2)
            ) AS rank
     FROM decision_records
     WHERE org_id = $1::uuid
       AND (
         to_tsvector('english', coalesce(title,'') || ' ' || coalesce(context,'') || ' ' ||
           coalesce(decision,'') || ' ' || coalesce(rationale,'') || ' ' || coalesce(notes,''))
           @@ plainto_tsquery('english', $2)
         OR title ILIKE '%' || $2 || '%'
         OR coalesce(decision,'') ILIKE '%' || $2 || '%'
         OR coalesce(rationale,'') ILIKE '%' || $2 || '%'
       )
     ORDER BY rank DESC NULLS LAST, season_year DESC, created_at DESC
     LIMIT $3`,
    [orgId, q, capped],
  );
  for (const row of decisions.rows) {
    const text = [row.decision, row.rationale, row.context].filter(Boolean).join(" — ");
    hits.push({
      source: "decision",
      id: row.id,
      title: row.title,
      snippet: snippetFrom(text || row.title, q),
      seasonYear: row.seasonYear,
      href: knowledgeHitHref("decision", row.id, orgId),
      rank: Number(row.rank) || 0.1,
    });
  }

  const reviews = await client.query<{
    id: string;
    title: string;
    seasonYear: number;
    subsystem: string;
    notes: string | null;
    rank: number;
  }>(
    `SELECT id, title, season_year AS "seasonYear", subsystem, notes,
            ts_rank(
              to_tsvector('english', coalesce(title,'') || ' ' || coalesce(subsystem,'') || ' ' || coalesce(notes,'')),
              plainto_tsquery('english', $2)
            ) AS rank
     FROM design_reviews
     WHERE org_id = $1::uuid
       AND (
         to_tsvector('english', coalesce(title,'') || ' ' || coalesce(subsystem,'') || ' ' || coalesce(notes,''))
           @@ plainto_tsquery('english', $2)
         OR title ILIKE '%' || $2 || '%'
         OR subsystem ILIKE '%' || $2 || '%'
         OR coalesce(notes,'') ILIKE '%' || $2 || '%'
       )
     ORDER BY rank DESC NULLS LAST, season_year DESC, updated_at DESC
     LIMIT $3`,
    [orgId, q, capped],
  );
  for (const row of reviews.rows) {
    hits.push({
      source: "design_review",
      id: row.id,
      title: `${row.title} (${row.subsystem})`,
      snippet: snippetFrom(row.notes || row.title, q),
      seasonYear: row.seasonYear,
      href: knowledgeHitHref("design_review", row.id, orgId),
      rank: Number(row.rank) || 0.1,
    });
  }

  return hits.sort((a, b) => b.rank - a.rank || (b.seasonYear ?? 0) - (a.seasonYear ?? 0)).slice(0, capped);
}

async function linkTargets(client: PoolClient, orgId: string) {
  const decisions = await client.query<{ id: string; title: string; seasonYear: number; status: string }>(
    `SELECT id, title, season_year AS "seasonYear", status
     FROM decision_records WHERE org_id = $1::uuid
     ORDER BY season_year DESC, created_at DESC LIMIT 80`,
    [orgId],
  );
  const reviews = await client.query<{
    id: string;
    title: string;
    seasonYear: number;
    subsystem: string;
    status: string;
  }>(
    `SELECT id, title, season_year AS "seasonYear", subsystem, status
     FROM design_reviews WHERE org_id = $1::uuid
     ORDER BY season_year DESC, updated_at DESC LIMIT 80`,
    [orgId],
  );
  return { decisions: decisions.rows, reviews: reviews.rows };
}

export async function loadKnowledgeWikiView(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    pageId?: string | null;
    pageSlug?: string | null;
    q?: string | null;
  },
): Promise<KnowledgeWikiView> {
  try {
    const member = await requireMember(client, input.orgId, input.userId);
    const pages = await listKnowledgePages(client, input.orgId);
    const selected =
      input.pageId || input.pageSlug
        ? await getKnowledgePage(client, input.orgId, {
            id: input.pageId ?? undefined,
            slug: input.pageSlug ?? undefined,
          })
        : pages[0]
          ? await getKnowledgePage(client, input.orgId, { id: pages[0].id })
          : null;
    const searchHits = input.q?.trim()
      ? await searchKnowledgeCorpus(client, input.orgId, input.q)
      : [];
    const targets = await linkTargets(client, input.orgId);
    return {
      status: "ready",
      orgId: input.orgId,
      orgName: member.orgName,
      teamNumber: member.teamNumber,
      role: member.role,
      canEdit: true,
      pages,
      selected,
      searchHits,
      searchQuery: input.q?.trim() ?? "",
      decisions: targets.decisions,
      reviews: targets.reviews,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Knowledge wiki unavailable";
    if (message.includes("does not exist") || message.includes("relation")) {
      return {
        status: "setup_required",
        orgId: input.orgId,
        message: "Knowledge wiki tables are not migrated yet. Run db:migrate, then reload.",
      };
    }
    throw error;
  }
}

export async function applyKnowledgeWikiAction(
  client: PoolClient,
  userId: string,
  action: KnowledgeWikiAction,
): Promise<void> {
  await requireMember(client, action.orgId, userId);

  if (action.action === "upsert_page") {
    if (action.id) {
      const updated = await client.query(
        `UPDATE knowledge_pages SET
           title = $3, slug = $4, body = $5, template_kind = $6,
           season_year = $7, tags = $8::text[], pinned = $9,
           updated_by = $10::uuid, updated_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid`,
        [
          action.id,
          action.orgId,
          action.title,
          action.slug,
          action.body,
          action.templateKind,
          action.seasonYear,
          action.tags,
          action.pinned,
          userId,
        ],
      );
      if (!updated.rowCount) throw new Error("Wiki page not found");
      return;
    }
    // A caller-supplied slug that already exists used to surface the raw
    // "duplicate key value violates constraint knowledge_pages_org_slug_unique"
    // — so writing the same playbook page twice (a re-run import, or the same
    // handoff page saved again) failed instead of updating. (org_id, slug) is
    // the page's identity, so upsert on it, which is what the action name says.
    await client.query(
      `INSERT INTO knowledge_pages
         (org_id, slug, title, body, template_kind, season_year, tags, pinned, created_by, updated_by)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::text[], $8, $9::uuid, $9::uuid)
       ON CONFLICT ON CONSTRAINT knowledge_pages_org_slug_unique DO UPDATE SET
         title = EXCLUDED.title,
         body = EXCLUDED.body,
         template_kind = EXCLUDED.template_kind,
         season_year = EXCLUDED.season_year,
         tags = EXCLUDED.tags,
         pinned = EXCLUDED.pinned,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [
        action.orgId,
        action.slug,
        action.title,
        action.body,
        action.templateKind,
        action.seasonYear,
        action.tags,
        action.pinned,
        userId,
      ],
    );
    return;
  }

  if (action.action === "delete_page") {
    const deleted = await client.query(
      `DELETE FROM knowledge_pages WHERE id = $1::uuid AND org_id = $2::uuid`,
      [action.id, action.orgId],
    );
    if (!deleted.rowCount) throw new Error("Wiki page not found");
    return;
  }

  if (action.action === "link") {
    const page = await client.query(
      `SELECT 1 FROM knowledge_pages WHERE id = $1::uuid AND org_id = $2::uuid`,
      [action.pageId, action.orgId],
    );
    if (!page.rowCount) throw new Error("Wiki page not found");
    if (action.targetType === "decision") {
      const found = await client.query(
        `SELECT 1 FROM decision_records WHERE id = $1::uuid AND org_id = $2::uuid`,
        [action.targetId, action.orgId],
      );
      if (!found.rowCount) throw new Error("Decision record not found");
    } else {
      const found = await client.query(
        `SELECT 1 FROM design_reviews WHERE id = $1::uuid AND org_id = $2::uuid`,
        [action.targetId, action.orgId],
      );
      if (!found.rowCount) throw new Error("Design review not found");
    }
    await client.query(
      `INSERT INTO knowledge_links (org_id, page_id, target_type, target_id, note, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::uuid)
       ON CONFLICT (org_id, page_id, target_type, target_id) DO UPDATE SET note = excluded.note`,
      [action.orgId, action.pageId, action.targetType, action.targetId, action.note, userId],
    );
    return;
  }

  if (action.action === "unlink") {
    const deleted = await client.query(
      `DELETE FROM knowledge_links WHERE id = $1::uuid AND org_id = $2::uuid`,
      [action.linkId, action.orgId],
    );
    if (!deleted.rowCount) throw new Error("Link not found");
  }
}
