import type { PoolClient } from "@neondatabase/serverless";
import { groupVideosByMatch, normalizeMatchKey, summarizeMatchVideoIndex } from ".";
import type { MatchVideoEntry, MatchVideoGroup, MatchVideoIndexSummary, MatchVideoSource } from "./types";

export const MATCH_VIDEO_SOURCES: MatchVideoSource[] = ["youtube", "drive", "twitch", "local", "other"];

export type MatchVideoIndexSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MatchVideoIndexView =
  | {
      status: "setup_required";
      message: string;
      steps: MatchVideoIndexSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      groups: MatchVideoGroup[];
      entries: MatchVideoEntry[];
      summary: MatchVideoIndexSummary;
      computedAt: string;
    };

type EntryRow = {
  id: string;
  matchKey: string;
  eventKey: string | null;
  matchLabel: string | null;
  videoUrl: string;
  source: MatchVideoSource;
  recordedOn: string | null;
  notes: string | null;
  tags: string[] | null;
  createdAt: string;
};

function mapEntry(row: EntryRow): MatchVideoEntry {
  return {
    id: row.id,
    matchKey: row.matchKey,
    eventKey: row.eventKey,
    matchLabel: row.matchLabel,
    videoUrl: row.videoUrl,
    source: row.source,
    recordedOn: row.recordedOn,
    notes: row.notes,
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.createdAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

export async function computeMatchVideoIndexView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<MatchVideoIndexView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to start indexing match videos.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const result = await client.query<EntryRow>(
    `SELECT id, match_key AS "matchKey", event_key AS "eventKey", match_label AS "matchLabel",
            video_url AS "videoUrl", source, recorded_on::text AS "recordedOn", notes,
            tags, created_at::text AS "createdAt"
     FROM match_video_index_entries
     WHERE org_id = $1
     ORDER BY created_at DESC`,
    [org.orgId],
  );

  const entries = result.rows.map(mapEntry);
  const groups = groupVideosByMatch(entries);
  const summary = summarizeMatchVideoIndex(entries);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    groups,
    entries,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addVideo(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    matchKey: string;
    eventKey: string | null;
    matchLabel: string | null;
    videoUrl: string;
    source: MatchVideoSource;
    recordedOn: string | null;
    notes: string | null;
    tags: string[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO match_video_index_entries (
       org_id, match_key, event_key, match_label, video_url, source, recorded_on, notes, tags, added_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9::text[],$10)`,
    [
      input.orgId,
      normalizeMatchKey(input.matchKey),
      input.eventKey,
      input.matchLabel,
      input.videoUrl,
      input.source,
      input.recordedOn,
      input.notes,
      input.tags,
      input.userId,
    ],
  );
}

export async function deleteVideo(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM match_video_index_entries WHERE id = $1 AND org_id = $2`, [
    input.entryId,
    input.orgId,
  ]);
}
