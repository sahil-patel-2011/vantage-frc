/**
 * Hand retro learned items into season report / playbook.
 *
 * Season report compute and the knowledge client stay untouched: this writes the
 * same tables those surfaces already read (`season_report_entries`, `knowledge_pages`).
 * A season with no real retro items refuses the write — no canned lessons.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { knowledgeHitHref } from "../knowledge/helpers";
import {
  buildPlaybookBody,
  collectLearnedItems,
  filterLearnedItems,
  parseHandoffTarget,
  parseRetroSourceId,
  playbookSlugForSeason,
  playbookTags,
  playbookTitleForSeason,
  seasonReportLessonDrafts,
} from "./learned-items";
import type {
  RetroHandoffResult,
  RetroHandoffStatus,
  RetroHandoffTarget,
  RetroLearnedItem,
} from "./types";

type LearnedRow = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  kind: RetroLearnedItem["kind"];
  content: string;
  authorName: string | null;
  createdAt: string;
  voteCount: string | number;
};

export async function loadSeasonLearnedItems(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<RetroLearnedItem[]> {
  const result = await client.query<LearnedRow>(
    `SELECT li.id, li.session_id AS "sessionId", ls.title AS "sessionTitle",
            li.kind, li.content,
            COALESCE(NULLIF(trim(au.name),''),au.email) AS "authorName",
            li.created_at::text AS "createdAt",
            COUNT(v.id) AS "voteCount"
     FROM retro_items li
     JOIN retro_sessions ls ON ls.id = li.session_id
     LEFT JOIN users au ON au.id = li.created_by
     LEFT JOIN retro_item_votes v ON v.item_id = li.id
     WHERE li.org_id = $1 AND ls.season_year = $2
     GROUP BY li.id, ls.title, au.name, au.email
     ORDER BY COUNT(v.id) DESC, li.created_at DESC`,
    [orgId, seasonYear],
  );
  return collectLearnedItems(result.rows);
}

export async function loadHandoffStatus(
  client: PoolClient,
  input: { orgId: string; seasonYear: number },
): Promise<RetroHandoffStatus> {
  const slug = playbookSlugForSeason(input.seasonYear);
  const [entries, page] = await Promise.all([
    client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM season_report_entries
       WHERE org_id = $1 AND season_year = $2 AND category = 'lessons'
         AND detail LIKE '%[source:retro:%'`,
      [input.orgId, input.seasonYear],
    ),
    client.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM knowledge_pages WHERE org_id = $1 AND slug = $2 LIMIT 1`,
      [input.orgId, slug],
    ),
  ]);
  const pageId = page.rows[0]?.id ?? null;
  return {
    seasonReportCount: Number(entries.rows[0]?.count) || 0,
    playbookPageId: pageId,
    playbookSlug: pageId ? (page.rows[0]?.slug ?? slug) : null,
    playbookHref: pageId ? knowledgeHitHref("wiki", pageId, input.orgId, slug) : null,
  };
}

const NO_ITEMS_MESSAGE =
  "No learned items to hand off. Add start/stop/continue items first — nothing is invented.";

export async function handoffLearnedItems(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    target?: unknown;
    itemIds?: readonly string[] | null;
  },
): Promise<RetroHandoffResult> {
  const target = parseHandoffTarget(input.target);
  const items = filterLearnedItems(
    await loadSeasonLearnedItems(client, input.orgId, input.seasonYear),
    input.itemIds,
  );
  if (items.length === 0) throw new Error(NO_ITEMS_MESSAGE);

  const seasonReport =
    target === "playbook" ? null : await writeSeasonReportLessons(client, { ...input, items });
  const playbook =
    target === "season-report"
      ? null
      : await writePlaybookPage(client, { ...input, items });

  return {
    target,
    learnedCount: items.length,
    seasonReport,
    playbook,
    message: handoffMessage({ target, learnedCount: items.length, seasonReport, playbook }),
  };
}

async function writeSeasonReportLessons(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; items: RetroLearnedItem[] },
): Promise<{ written: number; skipped: number }> {
  const existing = await client.query<{ detail: string | null }>(
    `SELECT detail FROM season_report_entries
     WHERE org_id = $1 AND season_year = $2 AND category = 'lessons'
       AND detail LIKE '%[source:retro:%'`,
    [input.orgId, input.seasonYear],
  );
  const already = new Set(
    existing.rows.map((row) => parseRetroSourceId(row.detail)).filter((id): id is string => Boolean(id)),
  );

  let written = 0;
  let skipped = 0;
  for (const draft of seasonReportLessonDrafts(input.items)) {
    if (already.has(draft.sourceItemId)) {
      skipped += 1;
      continue;
    }
    await client.query(
      `INSERT INTO season_report_entries (
         org_id, season_year, category, title, detail, metric_label, metric_value, sentiment, logged_by
       ) VALUES ($1,$2,$3,$4,$5,NULL,NULL,$6,$7)`,
      [input.orgId, input.seasonYear, draft.category, draft.title, draft.detail, draft.sentiment, input.userId],
    );
    written += 1;
  }
  return { written, skipped };
}

async function writePlaybookPage(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; items: RetroLearnedItem[] },
): Promise<RetroHandoffResult["playbook"]> {
  const body = buildPlaybookBody({ seasonYear: input.seasonYear, items: input.items });
  if (!body) throw new Error(NO_ITEMS_MESSAGE);

  const slug = playbookSlugForSeason(input.seasonYear);
  const title = playbookTitleForSeason(input.seasonYear);
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM knowledge_pages WHERE org_id = $1 AND slug = $2 LIMIT 1`,
    [input.orgId, slug],
  );
  if (existing.rowCount && existing.rows[0]) {
    const pageId = existing.rows[0].id;
    await client.query(
      `UPDATE knowledge_pages
       SET title = $3, body = $4, updated_by = $5, updated_at = now()
       WHERE org_id = $1 AND slug = $2`,
      [input.orgId, slug, title, body, input.userId],
    );
    return {
      pageId,
      slug,
      href: knowledgeHitHref("wiki", pageId, input.orgId, slug),
      alreadyExisted: true,
    };
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO knowledge_pages
       (org_id, slug, title, body, template_kind, season_year, tags, pinned, created_by, updated_by)
     VALUES ($1::uuid, $2, $3, $4, 'season_playbook', $5, $6::text[], false, $7::uuid, $7::uuid)
     RETURNING id`,
    [input.orgId, slug, title, body, input.seasonYear, playbookTags(), input.userId],
  );
  const pageId = inserted.rows[0]?.id;
  if (!pageId) throw new Error("Could not create the playbook page");
  return {
    pageId,
    slug,
    href: knowledgeHitHref("wiki", pageId, input.orgId, slug),
    alreadyExisted: false,
  };
}

function handoffMessage(input: {
  target: RetroHandoffTarget;
  learnedCount: number;
  seasonReport: { written: number; skipped: number } | null;
  playbook: RetroHandoffResult["playbook"];
}): string {
  const parts: string[] = [`${input.learnedCount} learned item${input.learnedCount === 1 ? "" : "s"} from real retro rows.`];
  if (input.seasonReport) {
    parts.push(
      `Season report: wrote ${input.seasonReport.written}, skipped ${input.seasonReport.skipped} already handed off.`,
    );
  }
  if (input.playbook) {
    parts.push(
      input.playbook.alreadyExisted
        ? "Playbook page updated from the current retro items."
        : "Playbook page created from the current retro items.",
    );
  }
  return parts.join(" ");
}

export { NO_ITEMS_MESSAGE };
