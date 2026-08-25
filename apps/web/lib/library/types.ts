/** Sharing scope, enforced by RLS (see migration 0489_team_library.sql). */
export type LibraryVisibility = "team" | "restricted";

/** A resource is an uploaded file OR an external link — both first-class. */
export type LibraryResourceKind = "file" | "link";

/** Where a file's bytes physically live (0483/0484 storage pattern). */
export type LibraryStorageLocation = "db" | "node";

/** Browse filter buckets, derived from extension/content-type. */
export type LibraryResourceType =
  | "cad"
  | "document"
  | "image"
  | "archive"
  | "code"
  | "link"
  | "other";

export type LibraryFolder = {
  id: string;
  parentId: string | null;
  name: string;
  visibility: LibraryVisibility;
  createdBy: string;
  createdByName: string | null;
  /** True when the viewer may rename / move / re-share / delete it. */
  canManage: boolean;
  /** Members explicitly granted access; null when the viewer cannot manage sharing. */
  grantedUserIds: string[] | null;
  createdAt: string;
};

export type LibraryAttachedLink = {
  id: string;
  resourceId: string;
  title: string;
  url: string;
  notes: string | null;
  createdBy: string;
  createdByName: string | null;
  canRemove: boolean;
  createdAt: string;
};

export type LibraryResource = {
  id: string;
  folderId: string | null;
  kind: LibraryResourceKind;
  type: LibraryResourceType;
  title: string;
  notes: string | null;
  tags: string[];
  visibility: LibraryVisibility;
  /** Link resources only. */
  url: string | null;
  /** File resources only. */
  fileName: string | null;
  contentType: string | null;
  byteSize: number | null;
  storageLocation: LibraryStorageLocation | null;
  status: "pending" | "ready";
  createdBy: string;
  createdByName: string | null;
  canManage: boolean;
  grantedUserIds: string[] | null;
  links: LibraryAttachedLink[];
  createdAt: string;
  /** Byte-serving URL for ready file resources; null for links. */
  src: string | null;
  /** Same URL when the file is an inline-previewable image; else null. */
  previewSrc: string | null;
};

export type LibraryMember = {
  id: string;
  name: string | null;
};

export type LibrarySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type LibraryView =
  | {
      status: "setup_required";
      message: string;
      steps: LibrarySetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      viewerId: string;
      viewerRole: string;
      folders: LibraryFolder[];
      resources: LibraryResource[];
      members: LibraryMember[];
      computedAt: string;
    };
