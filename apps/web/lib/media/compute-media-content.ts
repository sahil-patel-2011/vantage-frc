import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { emitNotification } from "@vantage/core";
import { buildMediaPostDraft } from "./media-content-helpers";
import type {
  MediaContentItem,
  MediaContentKind,
  MediaContentPlatform,
  MediaContentStatus,
  MediaPostDraftResult,
} from "./types";
import {
  MEDIA_CONTENT_KINDS,
  MEDIA_CONTENT_PLATFORMS,
  MEDIA_CONTENT_STATUSES,
} from "./types";

export {
  buildMediaPostDraft,
  isMediaReminderOverdue,
  mediaCalendarItems,
  mediaDraftItems,
  mediaReminderItems,
} from "./media-content-helpers";

type ContentRow = {
  id: string;
  seasonYear: number;
  kind: string;
  status: string;
  platform: string;
  title: string;
  caption: string | null;
  dueAt: string | null;
  remindAt: string | null;
  remindedAt: string | null;
  assignedTo: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function mapContent(row: ContentRow): MediaContentItem {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    kind: (oneOf(MEDIA_CONTENT_KINDS, row.kind) ?? "post") as MediaContentKind,
    status: (oneOf(MEDIA_CONTENT_STATUSES, row.status) ?? "draft") as MediaContentStatus,
    platform: (oneOf(MEDIA_CONTENT_PLATFORMS, row.platform) ?? "other") as MediaContentPlatform,
    title: row.title,
    caption: row.caption,
    dueAt: row.dueAt,
    remindAt: row.remindAt,
    remindedAt: row.remindedAt,
    assignedTo: row.assignedTo,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const CONTENT_SELECT = `SELECT id, season_year AS "seasonYear", kind, status, platform, title, caption,
       due_at AS "dueAt", remind_at AS "remindAt", reminded_at AS "remindedAt",
       assigned_to AS "assignedTo", created_by AS "createdBy", updated_by AS "updatedBy",
       created_at AS "createdAt", updated_at AS "updatedAt"
FROM media_content_items`;

export async function listMediaContentItems(
  client: PoolClient,
  input: { orgId: string; seasonYear: number },
): Promise<MediaContentItem[]> {
  const result = await client.query<ContentRow>(
    `${CONTENT_SELECT}
     WHERE org_id = $1 AND season_year = $2
     ORDER BY
       CASE status WHEN 'scheduled' THEN 0 WHEN 'draft' THEN 1 WHEN 'posted' THEN 2 ELSE 3 END,
       due_at ASC NULLS LAST,
       created_at DESC`,
    [input.orgId, input.seasonYear],
  );
  return result.rows.map(mapContent);
}

export type CreateMediaContentInput = {
  orgId: string;
  userId: string;
  seasonYear: number;
  title: string;
  kind?: MediaContentKind;
  status?: MediaContentStatus;
  platform?: MediaContentPlatform;
  caption?: string | null;
  dueAt?: string | null;
  remindAt?: string | null;
  assignedTo?: string | null;
};

export async function createMediaContentItem(
  client: PoolClient,
  input: CreateMediaContentInput,
): Promise<MediaContentItem> {
  const title = input.title.trim();
  if (!title) throw new Error("title is required");

  const kind = input.kind ?? "post";
  const status = input.status ?? (input.dueAt ? "scheduled" : "draft");
  const platform = input.platform ?? "other";

  const result = await client.query<ContentRow>(
    `INSERT INTO media_content_items (
       org_id, season_year, kind, status, platform, title, caption,
       due_at, remind_at, assigned_to, created_by, updated_by
     ) VALUES (
       $1::uuid, $2, $3, $4, $5, $6, $7,
       $8::timestamptz, $9::timestamptz, $10::uuid, $11::uuid, $11::uuid
     )
     RETURNING id, season_year AS "seasonYear", kind, status, platform, title, caption,
       due_at AS "dueAt", remind_at AS "remindAt", reminded_at AS "remindedAt",
       assigned_to AS "assignedTo", created_by AS "createdBy", updated_by AS "updatedBy",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      input.orgId,
      input.seasonYear,
      kind,
      status,
      platform,
      title.slice(0, 200),
      input.caption?.trim().slice(0, 4000) || null,
      input.dueAt ?? null,
      input.remindAt ?? null,
      input.assignedTo ?? null,
      input.userId,
    ],
  );
  return mapContent(result.rows[0]!);
}

export type UpdateMediaContentInput = {
  orgId: string;
  userId: string;
  itemId: string;
  title?: string;
  kind?: MediaContentKind;
  status?: MediaContentStatus;
  platform?: MediaContentPlatform;
  caption?: string | null;
  dueAt?: string | null;
  remindAt?: string | null;
  assignedTo?: string | null;
  clearRemindedAt?: boolean;
};

export async function updateMediaContentItem(
  client: PoolClient,
  input: UpdateMediaContentInput,
): Promise<MediaContentItem> {
  const existing = await client.query<ContentRow>(
    `${CONTENT_SELECT} WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.itemId, input.orgId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("Media content item not found");

  const title = input.title !== undefined ? input.title.trim() : row.title;
  if (!title) throw new Error("title is required");

  const remindAt = input.remindAt !== undefined ? input.remindAt : row.remindAt;
  const remindChanged =
    input.remindAt !== undefined && (input.remindAt ?? null) !== (row.remindAt ?? null);

  const result = await client.query<ContentRow>(
    `UPDATE media_content_items SET
       title = $3,
       kind = $4,
       status = $5,
       platform = $6,
       caption = $7,
       due_at = $8::timestamptz,
       remind_at = $9::timestamptz,
       assigned_to = $10::uuid,
       reminded_at = CASE
         WHEN $11::boolean THEN NULL
         ELSE reminded_at
       END,
       updated_by = $12::uuid,
       updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid
     RETURNING id, season_year AS "seasonYear", kind, status, platform, title, caption,
       due_at AS "dueAt", remind_at AS "remindAt", reminded_at AS "remindedAt",
       assigned_to AS "assignedTo", created_by AS "createdBy", updated_by AS "updatedBy",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      input.itemId,
      input.orgId,
      title.slice(0, 200),
      input.kind ?? row.kind,
      input.status ?? row.status,
      input.platform ?? row.platform,
      input.caption !== undefined ? input.caption?.trim().slice(0, 4000) || null : row.caption,
      input.dueAt !== undefined ? input.dueAt : row.dueAt,
      remindAt,
      input.assignedTo !== undefined ? input.assignedTo : row.assignedTo,
      Boolean(input.clearRemindedAt || remindChanged),
      input.userId,
    ],
  );
  return mapContent(result.rows[0]!);
}

export async function deleteMediaContentItem(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<void> {
  const result = await client.query(
    `DELETE FROM media_content_items WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.itemId, input.orgId],
  );
  if (!result.rowCount) throw new Error("Media content item not found");
}

export async function markMediaContentPosted(
  client: PoolClient,
  input: { orgId: string; userId: string; itemId: string },
): Promise<MediaContentItem> {
  return updateMediaContentItem(client, {
    orgId: input.orgId,
    userId: input.userId,
    itemId: input.itemId,
    status: "posted",
  });
}

/** Dismiss reminder — stamps reminded_at so it will not fire again. */
export async function dismissMediaReminder(
  client: PoolClient,
  input: { orgId: string; userId: string; itemId: string },
): Promise<MediaContentItem> {
  const result = await client.query<ContentRow>(
    `UPDATE media_content_items SET
       reminded_at = now(),
       updated_by = $3::uuid,
       updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid
       AND remind_at IS NOT NULL
     RETURNING id, season_year AS "seasonYear", kind, status, platform, title, caption,
       due_at AS "dueAt", remind_at AS "remindAt", reminded_at AS "remindedAt",
       assigned_to AS "assignedTo", created_by AS "createdBy", updated_by AS "updatedBy",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [input.itemId, input.orgId, input.userId],
  );
  if (!result.rows[0]) throw new Error("Media reminder not found");
  return mapContent(result.rows[0]);
}

/**
 * Metered AI draft helper — deterministic caption + optional due_at from title/platform/notes.
 * Returns setup_required when there is no usable input; never DEMO metrics.
 */
export async function suggestMediaPostDraft(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title?: string | null;
    platform?: string | null;
    notes?: string | null;
    itemId?: string | null;
  },
): Promise<MediaPostDraftResult> {
  let title = input.title?.trim() || "";
  let platform = input.platform?.trim() || "other";
  let notes = input.notes?.trim() || "";

  if (input.itemId) {
    const existing = await client.query<{
      title: string;
      platform: string;
      caption: string | null;
    }>(
      `SELECT title, platform, caption FROM media_content_items
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [input.itemId, input.orgId],
    );
    const row = existing.rows[0];
    if (row) {
      if (!title) title = row.title;
      if (!input.platform) platform = row.platform;
      if (!notes && row.caption) notes = row.caption;
    }
  }

  const draft = buildMediaPostDraft({ title, platform, notes });
  if (!draft) {
    return {
      status: "setup_required",
      message:
        "Add a title or notes before suggesting a caption — nothing is invented without real input.",
    };
  }

  const result = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "media_post_draft",
    requestId: `media-post-draft-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      hasTitle: Boolean(title),
      platform,
      itemId: input.itemId ?? null,
      note: "Deterministic caption/due draft — no external model call",
    },
    invoke: async () => ({
      value: draft,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-media-post-draft-v1",
      provider: "vantage-local",
    }),
  });

  if (input.itemId) {
    await updateMediaContentItem(client, {
      orgId: input.orgId,
      userId: input.userId,
      itemId: input.itemId,
      caption: result.caption,
      dueAt: result.dueAt,
      clearRemindedAt: false,
    });
  }

  return {
    status: "live",
    caption: result.caption,
    dueAt: result.dueAt,
    generatedAt: new Date().toISOString(),
    feature: "media_post_draft",
  };
}

/**
 * When remind_at is due, create an in-app notification and stamp reminded_at.
 * Targets assigned_to when set, otherwise created_by. Idempotent via reminded_at.
 */
export async function processDueMediaReminders(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear?: number },
): Promise<number> {
  const due = await client.query<{
    id: string;
    title: string;
    remindAt: string;
    assignedTo: string | null;
    createdBy: string;
  }>(
    `SELECT id, title, remind_at AS "remindAt",
            assigned_to AS "assignedTo", created_by AS "createdBy"
     FROM media_content_items
     WHERE org_id = $1::uuid
       AND remind_at IS NOT NULL
       AND reminded_at IS NULL
       AND remind_at <= now()
       AND status IN ('draft', 'scheduled')
       AND ($2::int IS NULL OR season_year = $2::int)
     ORDER BY remind_at ASC
     LIMIT 50`,
    [input.orgId, input.seasonYear ?? null],
  );

  let notified = 0;
  for (const row of due.rows) {
    const claimed = await client.query<{ id: string }>(
      `UPDATE media_content_items SET
         reminded_at = now(),
         updated_by = $3::uuid,
         updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid
         AND remind_at IS NOT NULL AND reminded_at IS NULL
       RETURNING id`,
      [row.id, input.orgId, input.userId],
    );
    if (!claimed.rows[0]) continue;

    const userId = row.assignedTo ?? row.createdBy;
    await emitNotification(client, {
      userId,
      orgId: input.orgId,
      type: "media_content_reminder",
      payload: {
        title: "Media post reminder",
        body: `"${row.title}" is due for a media reminder.`,
        summary: `"${row.title}" is due for a media reminder.`,
        itemId: row.id,
        remindAt: row.remindAt,
        href: `/media?tab=reminders&orgId=${encodeURIComponent(input.orgId)}`,
      },
    });
    notified += 1;
  }
  return notified;
}
