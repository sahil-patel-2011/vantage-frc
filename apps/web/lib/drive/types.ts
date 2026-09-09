/**
 * Vantage Drive — shared types. Client-safe: no node imports, so the page and
 * the API routes agree on one shape.
 */

import type { StorageContentClass } from "../storage-routing/types";

/**
 * Where a row lives, and who may read it.
 *
 * 'team'     — the team's. Every member reads it.
 * 'personal' — one person's. Only that person reads it. Owners and admins do
 *              NOT get a look, by design (migration 0641 has no role escape
 *              hatch on personal-scope policies) — a student's private space
 *              is not team property.
 */
export type DriveScope = "team" | "personal";

export const DRIVE_SCOPES: DriveScope[] = ["team", "personal"];

export type DriveStorageLocation = "db" | "node" | "object";

export type DriveFolder = {
  id: string;
  name: string;
  parentId: string | null;
  scope: DriveScope;
  createdAt: string;
  /** Files directly inside, excluding trash. Real count or nothing. */
  fileCount: number;
};

export type DriveFile = {
  id: string;
  name: string;
  folderId: string | null;
  scope: DriveScope;
  contentType: string;
  contentClass: StorageContentClass;
  byteSize: number;
  storageLocation: DriveStorageLocation;
  status: "pending" | "ready";
  hasThumb: boolean;
  uploadedBy: string;
  uploaderName: string | null;
  createdAt: string;
  updatedAt: string;
  /** How many live shares exist on this file (0 = not shared). */
  shareCount: number;
  /** True when the signed-in user may rename/move/delete it. */
  canManage: boolean;
};

/**
 * Media Library and CAD Vault items surfaced read-only inside Team files, so
 * the team's whole file world is in one place. No bytes are copied: each entry
 * links out to the page that owns it.
 */
export type DriveLinkedItem = {
  id: string;
  name: string;
  byteSize: number;
  contentType: string;
  createdAt: string;
  /** Where to go to actually work with this item. */
  href: string;
};

export type DriveVirtualFolderId = "media-library" | "cad-vault" | "team-library";

export type DriveVirtualFolder = {
  id: DriveVirtualFolderId;
  name: string;
  description: string;
  href: string;
  itemCount: number;
  items: DriveLinkedItem[];
};

export type DriveBreadcrumb = { id: string | null; name: string };

export type DriveShare = {
  id: string;
  kind: "link" | "email";
  email: string | null;
  note: string | null;
  canDownload: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
  createdBy: string;
  creatorName: string | null;
  target: { kind: "file"; id: string; name: string } | { kind: "folder"; id: string; name: string };
  /** Returned exactly once, at creation. Never stored, never re-derivable. */
  url?: string;
};

/** A file someone shared to this user's email address. */
export type DriveSharedWithMe = {
  shareId: string;
  note: string | null;
  canDownload: boolean;
  expiresAt: string | null;
  sharedAt: string;
  sharedByName: string | null;
  orgName: string;
  target: { kind: "file"; id: string; name: string } | { kind: "folder"; id: string; name: string };
  /** The /s/<token> link cannot be rebuilt from the hash, so this is the in-app route. */
  href: string;
};

export type DriveListing =
  | { status: "setup_required"; reason: string }
  | {
      status: "ready";
      orgId: string;
      orgName: string;
      scope: DriveScope;
      folderId: string | null;
      breadcrumbs: DriveBreadcrumb[];
      folders: DriveFolder[];
      files: DriveFile[];
      /** Only present at the root of Team files. */
      virtualFolders: DriveVirtualFolder[];
      /** Real per-location byte totals for this scope. Never estimated. */
      usage: { dbBytes: number; nodeBytes: number; objectBytes: number; fileCount: number };
      viewer: { userId: string; email: string; role: string };
    };

export type DriveUploadRoute =
  | { destination: "cloud"; fileId: string; reason: string; capBytes: number }
  | { destination: "node"; fileId: string; reason: string; ticket: unknown }
  | {
      destination: "object";
      fileId: string;
      reason: string;
      put: { url: string; expiresAt: string; headers: Record<string, string> };
    }
  | { destination: "refused"; reason: string };
