import type { PoolClient } from "@neondatabase/serverless";
import { searchHelpArticles } from "../help";

// ---------------------------------------------------------------------------
// Unified global search.
//
// A registry-driven search that fans a single query term across the app's key
// org-scoped tables. Every source runs a parameterized ILIKE query through the
// caller's `withRls` client, so Row-Level Security enforces tenancy: a member
// only ever sees rows for orgs they belong to. Results are normalized to a
// single typed shape carrying a human `sourceLabel` and a deep-link `href`.
//
// Help tutorials are static (in-repo) and merged first so Cmd+K can jump to
// docs without a CMS. To add a DB-backed feature, append a SearchSource.
// ---------------------------------------------------------------------------

export type SearchSourceId = "tasks" | "inventory" | "impact" | "knowledge" | "help";

export type SearchResult = {
  /** Row primary key (uuid). */
  id: string;
  /** Registry id of the source table this row came from. */
  source: SearchSourceId;
  /** Human-facing label for the source, e.g. "Build Tasks". */
  sourceLabel: string;
  /** Primary display line. */
  title: string;
  /** Secondary context line (category / status / etc.), or null. */
  subtitle: string | null;
  /** In-app deep link to the feature surface for this row. */
  href: string;
  /** ISO timestamp used for cross-source ordering, or null when unknown. */
  updatedAt: string | null;
};

export type UnifiedSearchView =
  | {
      status: "setup_required";
      message: string;
      orgId: string | null;
      query: string;
    }
  | {
      status: "ready";
      orgId: string;
      query: string;
      results: SearchResult[];
      /** Source ids that were queried (drives the UI filter chips). */
      sources: { id: SearchSourceId; label: string }[];
    };

/** Longest term we bother querying; keeps ILIKE bounded. */
const MAX_TERM = 120;
/** Per-source row cap so one noisy table cannot swamp the merged list. */
const PER_SOURCE_LIMIT = 8;
/** Merged result cap returned to the client. */
const TOTAL_LIMIT = 40;

/**
 * Normalize a user-supplied query. Returns null when there is nothing
 * meaningful to search (empty / whitespace / a lone wildcard).
 */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, MAX_TERM);
  return trimmed.length >= 2 ? trimmed : null;
}

/** Escape LIKE/ILIKE wildcards so user input is matched literally. */
function likePattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

function orgHref(base: string, orgId: string): string {
  return `${base}?orgId=${encodeURIComponent(orgId)}`;
}

// ---------------------------------------------------------------------------
// Source registry. Each source owns exactly one parameterized query and maps
// its rows into SearchResult. Params are always ($1 orgId::uuid, $2 pattern,
// $3 limit); SQL is never string-concatenated with user input.
// ---------------------------------------------------------------------------

type SearchSource = {
  id: SearchSourceId;
  label: string;
  run: (client: PoolClient, orgId: string, pattern: string, limit: number) => Promise<SearchResult[]>;
};

export const SEARCH_SOURCES: SearchSource[] = [
  {
    id: "tasks",
    label: "Build Tasks",
    run: async (client, orgId, pattern, limit) => {
      const { rows } = await client.query<{
        id: string;
        title: string;
        subsystem: string;
        status: string;
        updatedAt: string | null;
      }>(
        `SELECT id, title, subsystem, status, updated_at AS "updatedAt"
           FROM build_tasks
          WHERE org_id = $1::uuid
            AND status <> 'archived'
            AND (
              title ILIKE $2 ESCAPE '\\'
              OR subsystem ILIKE $2 ESCAPE '\\'
              OR coalesce(notes, '') ILIKE $2 ESCAPE '\\'
              OR coalesce(assignee, '') ILIKE $2 ESCAPE '\\'
            )
          ORDER BY updated_at DESC
          LIMIT $3`,
        [orgId, pattern, limit],
      );
      return rows.map((row) => ({
        id: row.id,
        source: "tasks" as const,
        sourceLabel: "Build Tasks",
        title: row.title,
        subtitle: `${row.subsystem} · ${row.status.replace(/_/g, " ")}`,
        href: orgHref("/tasks", orgId),
        updatedAt: row.updatedAt,
      }));
    },
  },
  {
    id: "inventory",
    label: "Inventory",
    run: async (client, orgId, pattern, limit) => {
      const { rows } = await client.query<{
        id: string;
        name: string;
        category: string;
        partNumber: string | null;
        vendor: string | null;
        updatedAt: string | null;
      }>(
        `SELECT id, name, category, part_number AS "partNumber", vendor, updated_at AS "updatedAt"
           FROM inventory_items
          WHERE org_id = $1::uuid
            AND archived = false
            AND (
              name ILIKE $2 ESCAPE '\\'
              OR coalesce(part_number, '') ILIKE $2 ESCAPE '\\'
              OR coalesce(vendor, '') ILIKE $2 ESCAPE '\\'
              OR coalesce(subsystem, '') ILIKE $2 ESCAPE '\\'
            )
          ORDER BY updated_at DESC
          LIMIT $3`,
        [orgId, pattern, limit],
      );
      return rows.map((row) => {
        const parts = [row.category, row.partNumber, row.vendor].filter(
          (part): part is string => Boolean(part),
        );
        return {
          id: row.id,
          source: "inventory" as const,
          sourceLabel: "Inventory",
          title: row.name,
          subtitle: parts.length ? parts.join(" · ") : null,
          href: orgHref("/inventory", orgId),
          updatedAt: row.updatedAt,
        };
      });
    },
  },
  {
    id: "impact",
    label: "Community Impact",
    run: async (client, orgId, pattern, limit) => {
      const { rows } = await client.query<{
        id: string;
        title: string;
        category: string;
        occurredOn: string | null;
        updatedAt: string | null;
      }>(
        `SELECT id, title, category, occurred_on AS "occurredOn", created_at AS "updatedAt"
           FROM impact_activities
          WHERE org_id = $1::uuid
            AND (
              title ILIKE $2 ESCAPE '\\'
              OR coalesce(description, '') ILIKE $2 ESCAPE '\\'
              OR coalesce(location, '') ILIKE $2 ESCAPE '\\'
            )
          ORDER BY occurred_on DESC
          LIMIT $3`,
        [orgId, pattern, limit],
      );
      return rows.map((row) => ({
        id: row.id,
        source: "impact" as const,
        sourceLabel: "Community Impact",
        title: row.title,
        subtitle: [row.category.replace(/_/g, " "), row.occurredOn].filter(Boolean).join(" · ") || null,
        href: orgHref("/impact", orgId),
        updatedAt: row.updatedAt,
      }));
    },
  },
  {
    id: "knowledge",
    label: "Team Knowledge",
    run: async (client, orgId, pattern, limit) => {
      const { rows } = await client.query<{
        id: string;
        slug: string;
        title: string;
        templateKind: string;
        updatedAt: string | null;
      }>(
        `SELECT id, slug, title, template_kind AS "templateKind", updated_at AS "updatedAt"
           FROM knowledge_pages
          WHERE org_id = $1::uuid
            AND (
              title ILIKE $2 ESCAPE '\\'
              OR body ILIKE $2 ESCAPE '\\'
              OR slug ILIKE $2 ESCAPE '\\'
            )
          ORDER BY updated_at DESC
          LIMIT $3`,
        [orgId, pattern, limit],
      );
      return rows.map((row) => ({
        id: row.id,
        source: "knowledge" as const,
        sourceLabel: "Team Knowledge",
        title: row.title,
        subtitle: row.templateKind === "blank" ? null : row.templateKind.replace(/_/g, " "),
        href: orgHref("/team/knowledge", orgId),
        updatedAt: row.updatedAt,
      }));
    },
  },
];

/**
 * Resolve the org to search within. Prefers the requested org when the user is
 * a member of it; otherwise falls back to their highest-privilege membership.
 * Returns null when the user has no membership at all (setup_required).
 */
async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<string | null> {
  const { rows } = await client.query<{ orgId: string }>(
    `SELECT m.org_id AS "orgId"
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1
        AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
      LIMIT 1`,
    [userId, requestedOrg],
  );
  return rows[0]?.orgId ?? null;
}

/**
 * Run the unified search. Caller must supply a `withRls`-bound client so every
 * source query is subject to the same tenancy context.
 *
 * Help tutorials are static and available even before a workspace is selected.
 */
export async function computeUnifiedSearch(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; query: string | null },
): Promise<UnifiedSearchView> {
  const query = normalizeQuery(input.query);
  const orgId = await resolveOrg(client, input.userId, input.requestedOrg);

  const helpHits: SearchResult[] = query
    ? searchHelpArticles(query, PER_SOURCE_LIMIT).map((hit) => ({
        id: hit.id,
        source: "help" as const,
        sourceLabel: "Help",
        title: hit.title,
        subtitle: hit.subtitle,
        href: hit.href,
        updatedAt: null,
      }))
    : [];

  const sourceMetaBase = [
    { id: "help" as const, label: "Help" },
    ...SEARCH_SOURCES.map((source) => ({ id: source.id, label: source.label })),
  ];

  if (!orgId) {
    if (helpHits.length > 0) {
      return {
        status: "ready",
        orgId: "",
        query: query ?? "",
        results: helpHits,
        sources: [{ id: "help", label: "Help" }],
      };
    }
    return {
      status: "setup_required",
      message: "Join or select a team workspace to search across your team's data. App manual topics still work from /docs.",
      orgId: null,
      query: query ?? "",
    };
  }

  if (!query) {
    return {
      status: "ready",
      orgId,
      query: "",
      results: [],
      sources: sourceMetaBase,
    };
  }

  const pattern = likePattern(query);
  const settled = await Promise.all(
    SEARCH_SOURCES.map(async (source) => {
      try {
        return await source.run(client, orgId, pattern, PER_SOURCE_LIMIT);
      } catch {
        // A single missing/failing source must not sink the whole search.
        return [] as SearchResult[];
      }
    }),
  );

  const dataHits = settled
    .flat()
    .sort((a, b) => {
      const at = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bt - at;
    });

  // Help first for topic jumps (island, Automode, credits…), then org data.
  const results = [...helpHits, ...dataHits].slice(0, TOTAL_LIMIT);

  return {
    status: "ready",
    orgId,
    query,
    results,
    sources: sourceMetaBase,
  };
}
