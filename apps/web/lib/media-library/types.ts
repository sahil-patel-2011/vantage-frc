export type MediaKind = "photo" | "video";

/** Where an item's bytes physically live. */
export type MediaStorageLocation = "db" | "node";

/**
 * Which table a row in the unified library list came from. The library is the
 * one place all team media appears — pit-scouting photos and business sponsor
 * artwork are surfaced read-only alongside native library items without
 * migrating their tables.
 */
export type MediaOrigin = "library" | "pit_scouting" | "business_assets";

export type MediaLibraryItem = {
  id: string;
  origin: MediaOrigin;
  kind: MediaKind;
  title: string;
  caption: string | null;
  albumId: string | null;
  takenAt: string | null;
  eventKey: string | null;
  subteam: string | null;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  storageLocation: MediaStorageLocation;
  status: "pending" | "ready";
  uploaderId: string | null;
  uploaderName: string | null;
  /** True when the current viewer may delete / edit this item. */
  canManage: boolean;
  createdAt: string;
  /** URL that serves the full bytes (Range-capable for library items). */
  src: string;
  /** URL for the small in-database thumbnail, when one exists. */
  thumbnailSrc: string | null;
};

export type MediaAlbumSummary = {
  id: string;
  name: string;
  description: string | null;
  eventKey: string | null;
  coverItemId: string | null;
  itemCount: number;
  createdAt: string;
};

export type MediaStorageMeter = {
  /** Real SUM(byte_size) of ready in-database library items. */
  dbBytes: number;
  dbItemCount: number;
  /** Real SUM(byte_size) of node-hosted metadata rows. */
  nodeBytes: number;
  nodeItemCount: number;
  headline: string;
  hint: string;
};

export type MediaLibrarySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MediaLibraryView =
  | {
      status: "setup_required";
      message: string;
      steps: MediaLibrarySetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      viewerId: string;
      viewerRole: string;
      albums: MediaAlbumSummary[];
      items: MediaLibraryItem[];
      meter: MediaStorageMeter;
      computedAt: string;
    };
