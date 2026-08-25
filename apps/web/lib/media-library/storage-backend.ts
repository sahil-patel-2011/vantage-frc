/**
 * Storage backend seam. A media item's bytes live either in the database row
 * ('db') or on a paired team storage node ('node' — being built in parallel as
 * packages/storage-node + migration 0484). Everything above this interface is
 * identical for both, so the library stands alone if the node ships later.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { MediaStorageLocation } from "./types";

export type MediaBytesResult =
  | { kind: "bytes"; bytes: Buffer; contentType: string }
  /** Node-hosted item: the caller should 307 to the node proxy route. */
  | { kind: "redirect"; location: string }
  | { kind: "unavailable"; reason: string };

export type StoredItemRef = {
  id: string;
  orgId: string;
  contentType: string;
  storageLocation: MediaStorageLocation;
  nodeItemId: string | null;
};

export interface MediaStorageBackend {
  readonly location: MediaStorageLocation;
  fetchBytes(client: PoolClient, item: StoredItemRef): Promise<MediaBytesResult>;
}

/**
 * Single place that knows the node-item resolver contract: the route resolves
 * a storage_node_items id, mints a short-lived signed GET grant, and 307s the
 * browser STRAIGHT to the node (bytes never transit the hosted deployment).
 * Implemented at apps/web/app/api/storage/node-item/[id]/route.ts.
 */
export function nodeProxyPath(nodeItemId: string, orgId: string): string {
  return `/api/storage/node-item/${encodeURIComponent(nodeItemId)}?orgId=${encodeURIComponent(orgId)}`;
}

class DbMediaStorageBackend implements MediaStorageBackend {
  readonly location = "db" as const;

  async fetchBytes(client: PoolClient, item: StoredItemRef): Promise<MediaBytesResult> {
    const result = await client.query<{ bytes: Buffer | null; contentType: string }>(
      `SELECT bytes, content_type AS "contentType"
       FROM media_items
       WHERE id = $1::uuid AND org_id = $2::uuid AND storage_location = 'db'
       LIMIT 1`,
      [item.id, item.orgId],
    );
    const row = result.rows[0];
    if (!row?.bytes) {
      return { kind: "unavailable", reason: "Upload has not finished yet." };
    }
    return { kind: "bytes", bytes: Buffer.from(row.bytes), contentType: row.contentType };
  }
}

class NodeMediaStorageBackend implements MediaStorageBackend {
  readonly location = "node" as const;

  async fetchBytes(_client: PoolClient, item: StoredItemRef): Promise<MediaBytesResult> {
    if (!item.nodeItemId) {
      return { kind: "unavailable", reason: "This item points at a storage node but has no node reference." };
    }
    return { kind: "redirect", location: nodeProxyPath(item.nodeItemId, item.orgId) };
  }
}

const backends: Record<MediaStorageLocation, MediaStorageBackend> = {
  db: new DbMediaStorageBackend(),
  node: new NodeMediaStorageBackend(),
};

export function storageBackendFor(location: MediaStorageLocation): MediaStorageBackend {
  return backends[location];
}
