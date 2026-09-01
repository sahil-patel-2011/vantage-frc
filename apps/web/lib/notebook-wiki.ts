/**
 * Promoting a notebook entry into the team wiki.
 *
 * The engineering notebook is a dated journal — the right shape while a season is running, the
 * wrong shape a year later when a new student asks "why is the intake geared like that?". The
 * knowledge wiki is where a team's durable answers live, and exit interviews already publish into
 * it. This is the same move for the other end of the lifecycle: a decision that turned out to
 * matter gets lifted out of the journal and into the reference.
 *
 * No new tables. The page is a `knowledge_pages` row like any other, and the slug is derived from
 * the entry id so promoting the same entry twice finds the existing page instead of filling the
 * wiki with near-duplicates. (A `notebook_entries.knowledge_page_id` column would let the entry
 * itself carry the link; the deterministic slug is the version that needs no migration.)
 */

import type { PoolClient } from "@neondatabase/serverless";
import { BUILD_PHASE_LABEL, type BuildPhase } from "./notebook";
import {
  attachmentIdsFromTags,
  isNotebookAssetTag,
  isNotebookImageKind,
  resolveNotebookAttachments,
  type NotebookImageAttachment,
} from "./notebook/attachments";

function isWikiPhotoCite(row: Pick<NotebookImageAttachment, "url" | "kind">): boolean {
  return Boolean(row.url.trim()) && isNotebookImageKind(row.kind) && row.kind !== "video";
}

function isWikiVideoCite(row: Pick<NotebookImageAttachment, "url" | "kind">): boolean {
  return Boolean(row.url.trim()) && row.kind === "video";
}

export type PromotableEntry = {
  id: string;
  title: string;
  body: string;
  entryDate: string;
  phase: BuildPhase;
  subsystem: string;
  tags: string[];
  seasonYear: number;
  authorName: string | null;
  attachments: NotebookImageAttachment[];
};

const slugSafe = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** Deterministic in the entry id, which is what makes promotion idempotent. */
export function notebookWikiSlug(entry: Pick<PromotableEntry, "id" | "title" | "seasonYear">): string {
  const stem = slugSafe(entry.title) || "notebook-entry";
  return `notebook-${entry.seasonYear}-${stem}-${entry.id.slice(0, 8)}`.slice(0, 120);
}

export function notebookWikiTitle(entry: Pick<PromotableEntry, "title" | "subsystem">): string {
  const subsystem = entry.subsystem.trim();
  return subsystem ? `${subsystem}: ${entry.title}` : entry.title;
}

/**
 * The page body. Provenance goes at the top on purpose: a reader a year from now needs to know
 * this is a snapshot of one day's thinking, not a maintained spec, and needs the date to judge
 * whether it still applies.
 */
export function buildNotebookWikiBody(entry: PromotableEntry): string {
  const lines: string[] = [];
  lines.push(
    `> Promoted from the engineering notebook entry of ${entry.entryDate}` +
      (entry.authorName ? ` by ${entry.authorName}` : "") +
      `. Phase: ${BUILD_PHASE_LABEL[entry.phase] ?? entry.phase}.`,
  );
  lines.push("");
  if (entry.subsystem.trim()) {
    lines.push(`**Subsystem:** ${entry.subsystem.trim()}`);
    lines.push("");
  }
  lines.push("## What we decided");
  lines.push("");
  lines.push(entry.body.trim() || "_The original notebook entry had no body text._");
  lines.push("");
  lines.push("## Photos");
  lines.push("");
  const attachments = entry.attachments ?? [];
  const photos = attachments.filter(isWikiPhotoCite);
  const videos = attachments.filter(isWikiVideoCite);
  if (photos.length) {
    for (const photo of photos) {
      lines.push(`![${photo.title}](${photo.url})`);
      lines.push("");
    }
  } else {
    lines.push("_No photo was attached to the original notebook entry._");
    lines.push("");
  }
  if (videos.length) {
    lines.push("## Videos");
    lines.push("");
    for (const video of videos) {
      // Wiki MarkdownDocument is markdown-only — no <video> or image-for-clip.
      lines.push(`[Video: ${video.title}](${video.url})`);
      lines.push("");
    }
  }
  lines.push("## Still true?");
  lines.push("");
  lines.push(
    "_Update this section when the design changes so the next student reads the current answer, not the original one._",
  );
  if (entry.tags.length) {
    lines.push("");
    lines.push(`Tags: ${entry.tags.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Promoted entries land under an existing template kind rather than a new one — a subsystem entry
 * files with the subsystem dumps, everything else under "other".
 */
export function notebookTemplateKind(entry: Pick<PromotableEntry, "subsystem">): "subsystem" | "other" {
  return entry.subsystem.trim() ? "subsystem" : "other";
}

export function notebookWikiTags(entry: PromotableEntry): string[] {
  const tags = new Set<string>(["notebook"]);
  const subsystem = slugSafe(entry.subsystem);
  if (subsystem) tags.add(subsystem);
  tags.add(entry.phase);
  for (const tag of entry.tags) {
    if (!isNotebookAssetTag(tag)) tags.add(tag);
  }
  return [...tags].slice(0, 12);
}

export type PromoteResult = {
  pageId: string;
  slug: string;
  /** True when the entry had already been promoted and the existing page was returned. */
  alreadyPromoted: boolean;
};

/**
 * Read the entry, write (or find) its wiki page. Runs inside the caller's `withRls` transaction;
 * `orgId` scopes the read so an entry id from another team is simply not found.
 */
export async function promoteNotebookEntry(
  client: PoolClient,
  input: { orgId: string; userId: string; entryId: string },
): Promise<PromoteResult> {
  const row = await client.query<PromotableEntry>(
    `SELECT n.id, n.title, n.body, n.entry_date::text AS "entryDate", n.phase, n.subsystem,
            n.tags, n.season_year AS "seasonYear", u.name AS "authorName"
     FROM notebook_entries n
     LEFT JOIN users u ON u.id = n.author_user_id
     WHERE n.id = $1::uuid AND n.org_id = $2::uuid`,
    [input.entryId, input.orgId],
  );
  const entry = row.rows[0];
  if (!entry) throw new Error("Entry not found");

  const attachmentIds = attachmentIdsFromTags(entry.tags);
  const attachments = await resolveNotebookAttachments(client, {
    orgId: input.orgId,
    assetIds: attachmentIds,
  });
  const promoted: PromotableEntry = { ...entry, attachments };

  const slug = notebookWikiSlug(promoted);
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM knowledge_pages WHERE org_id = $1::uuid AND slug = $2 LIMIT 1`,
    [input.orgId, slug],
  );
  if (existing.rowCount) {
    return { pageId: existing.rows[0]!.id, slug, alreadyPromoted: true };
  }

  const page = await client.query<{ id: string }>(
    `INSERT INTO knowledge_pages
       (org_id, slug, title, body, template_kind, season_year, tags, pinned, created_by, updated_by)
     VALUES ($1::uuid, $2, $3, $4, $8, $5, $6::text[], false, $7::uuid, $7::uuid)
     RETURNING id`,
    [
      input.orgId,
      slug,
      notebookWikiTitle(promoted),
      buildNotebookWikiBody(promoted),
      promoted.seasonYear,
      notebookWikiTags(promoted),
      input.userId,
      notebookTemplateKind(promoted),
    ],
  );
  const pageId = page.rows[0]?.id;
  if (!pageId) throw new Error("Could not create the wiki page");
  return { pageId, slug, alreadyPromoted: false };
}
