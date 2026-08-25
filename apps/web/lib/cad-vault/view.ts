/**
 * CAD vault view: setup_required (no workspace) | empty (no documents yet) |
 * ready. Includes an honest per-subsystem rollup — documents with no subsystem
 * land in an explicit "unassigned" bucket, never silently dropped.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { CadFormat } from "./format-detect";

export const CAD_DOCUMENT_KINDS = ["part", "assembly", "drawing", "print", "vendor", "other"] as const;
export type CadDocumentKind = (typeof CAD_DOCUMENT_KINDS)[number];

export const CAD_DOCUMENT_STATUSES = ["active", "superseded", "archived"] as const;
export type CadDocumentStatus = (typeof CAD_DOCUMENT_STATUSES)[number];

export function cadKindLabel(kind: CadDocumentKind): string {
  switch (kind) {
    case "part": return "Part";
    case "assembly": return "Assembly";
    case "drawing": return "Drawing";
    case "print": return "3D print";
    case "vendor": return "Vendor file";
    case "other": return "Other";
  }
}

export type CadVersionSummary = {
  publicId: string;
  version: number;
  filename: string;
  format: CadFormat;
  byteSize: number;
  checksumSha256: string;
  hasThumbnail: boolean;
  /** null when the format was not parsed server-side (everything except STL). */
  geometry: Record<string, unknown> | null;
  changeNote: string | null;
  uploadedBy: string;
  createdAt: string;
};

export type CadDocumentSummary = {
  id: string;
  title: string;
  description: string | null;
  kind: CadDocumentKind;
  status: CadDocumentStatus;
  seasonYear: number;
  subsystemId: string | null;
  subsystemName: string | null;
  externalUrl: string | null;
  currentVersion: number;
  totalBytes: number;
  latest: CadVersionSummary | null;
  versions: CadVersionSummary[];
  createdAt: string;
  updatedAt: string;
};

export type SubsystemOption = { id: string; name: string; category: string };

export type SubsystemRollup = {
  subsystemId: string | null;
  subsystemName: string;
  documentCount: number;
  versionCount: number;
  totalBytes: number;
};

export type CadVaultSetupStep = { id: string; label: string; detail: string; href: string };

export type CadVaultView =
  | {
      status: "setup_required";
      message: string;
      steps: CadVaultSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "empty" | "ready";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      documents: CadDocumentSummary[];
      subsystems: SubsystemOption[];
      rollup: SubsystemRollup[];
      totalBytes: number;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

/** Pure rollup: group document/version counts and bytes by linked subsystem. */
export function rollupBySubsystem(documents: CadDocumentSummary[]): SubsystemRollup[] {
  const buckets = new Map<string | null, SubsystemRollup>();
  for (const doc of documents) {
    const key = doc.subsystemId;
    const bucket = buckets.get(key) ?? {
      subsystemId: key,
      subsystemName: doc.subsystemName ?? "Unassigned",
      documentCount: 0,
      versionCount: 0,
      totalBytes: 0,
    };
    bucket.documentCount += 1;
    bucket.versionCount += doc.versions.length;
    bucket.totalBytes += doc.totalBytes;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => {
    if (a.subsystemId === null) return 1;
    if (b.subsystemId === null) return -1;
    return b.totalBytes - a.totalBytes || a.subsystemName.localeCompare(b.subsystemName);
  });
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

type DocumentRow = {
  id: string;
  title: string;
  description: string | null;
  kind: CadDocumentKind;
  status: CadDocumentStatus;
  seasonYear: number;
  subsystemId: string | null;
  subsystemName: string | null;
  externalUrl: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
};

type VersionRow = {
  documentId: string;
  publicId: string;
  version: number;
  filename: string;
  format: CadFormat;
  byteSize: number;
  checksumSha256: string;
  hasThumbnail: boolean;
  geometry: Record<string, unknown>;
  changeNote: string | null;
  uploadedBy: string;
  createdAt: string;
};

export async function computeCadVaultView(
  client: PoolClient,
  params: { userId: string; requestedOrg: string | null; seasonYear: number | null },
): Promise<CadVaultView> {
  const org = await resolveOrg(client, params.userId, params.requestedOrg);
  const fallbackSeason = params.seasonYear ?? currentSeasonYear();
  if (!org) {
    return {
      status: "setup_required",
      message: "Join or select a team workspace to use the CAD vault.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear: fallbackSeason,
    };
  }

  const seasonsResult = await client.query<{ seasonYear: number }>(
    `SELECT DISTINCT season_year AS "seasonYear" FROM cad_documents WHERE org_id = $1::uuid ORDER BY season_year DESC`,
    [org.orgId],
  );
  const seasons = seasonsResult.rows.map((row) => Number(row.seasonYear));
  const seasonYear = params.seasonYear ?? seasons[0] ?? fallbackSeason;

  const documentsResult = await client.query<DocumentRow>(
    `SELECT d.id, d.title, d.description, d.kind, d.status,
            d.season_year AS "seasonYear", d.subsystem_id AS "subsystemId",
            s.name AS "subsystemName", d.external_url AS "externalUrl",
            d.current_version AS "currentVersion",
            d.created_at::text AS "createdAt", d.updated_at::text AS "updatedAt"
     FROM cad_documents d
     LEFT JOIN robot_subsystems s ON s.id = d.subsystem_id
     WHERE d.org_id = $1::uuid AND d.season_year = $2::int
     ORDER BY d.updated_at DESC`,
    [org.orgId, seasonYear],
  );

  const versionsResult = await client.query<VersionRow>(
    `SELECT v.document_id AS "documentId", v.public_id AS "publicId", v.version,
            v.filename, v.format, v.byte_size AS "byteSize",
            v.checksum_sha256 AS "checksumSha256",
            (v.thumbnail_png IS NOT NULL) AS "hasThumbnail",
            v.geometry, v.change_note AS "changeNote",
            v.uploaded_by AS "uploadedBy", v.created_at::text AS "createdAt"
     FROM cad_document_versions v
     JOIN cad_documents d ON d.id = v.document_id
     WHERE v.org_id = $1::uuid AND d.season_year = $2::int
     ORDER BY v.document_id, v.version DESC`,
    [org.orgId, seasonYear],
  );

  const versionsByDocument = new Map<string, CadVersionSummary[]>();
  for (const row of versionsResult.rows) {
    const geometry = row.geometry && Object.keys(row.geometry).length > 0 ? row.geometry : null;
    const list = versionsByDocument.get(row.documentId) ?? [];
    list.push({
      publicId: row.publicId,
      version: Number(row.version),
      filename: row.filename,
      format: row.format,
      byteSize: Number(row.byteSize),
      checksumSha256: row.checksumSha256,
      hasThumbnail: row.hasThumbnail,
      geometry,
      changeNote: row.changeNote,
      uploadedBy: row.uploadedBy,
      createdAt: row.createdAt,
    });
    versionsByDocument.set(row.documentId, list);
  }

  const documents: CadDocumentSummary[] = documentsResult.rows.map((row) => {
    const versions = versionsByDocument.get(row.id) ?? [];
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      kind: row.kind,
      status: row.status,
      seasonYear: Number(row.seasonYear),
      subsystemId: row.subsystemId,
      subsystemName: row.subsystemName,
      externalUrl: row.externalUrl,
      currentVersion: Number(row.currentVersion),
      totalBytes: versions.reduce((sum, v) => sum + v.byteSize, 0),
      latest: versions[0] ?? null,
      versions,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  const subsystemsResult = await client.query<SubsystemOption>(
    `SELECT id, name, category FROM robot_subsystems
     WHERE org_id = $1::uuid AND season_year = $2::int
     ORDER BY category, name`,
    [org.orgId, seasonYear],
  );

  return {
    status: documents.length === 0 ? "empty" : "ready",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons: seasons.length > 0 ? seasons : [seasonYear],
    documents,
    subsystems: subsystemsResult.rows,
    rollup: rollupBySubsystem(documents),
    totalBytes: documents.reduce((sum, doc) => sum + doc.totalBytes, 0),
    computedAt: new Date().toISOString(),
  };
}
