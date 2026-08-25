/**
 * Storage routing: per-org policy deciding where each new file's bytes go —
 * the hosted database ('cloud') or the team's paired storage node ('node',
 * packages/storage-node). Pure types shared by the pure decision logic, the
 * API routes, and the upload clients. Client-safe: no node imports.
 */

import type { NodeLiveness } from "../storage-node";

/** Coarse content classes the routing policy can reason about. */
export type StorageContentClass =
  | "video"
  | "cad"
  | "archive"
  | "photo"
  | "document"
  | "other";

export const STORAGE_CONTENT_CLASSES: StorageContentClass[] = [
  "video",
  "cad",
  "archive",
  "photo",
  "document",
  "other",
];

export type StorageRoutingPolicy = {
  /** Files STRICTLY larger than this prefer the node. */
  nodeThresholdBytes: number;
  /** Content classes that always prefer the node regardless of size. */
  preferNodeClasses: StorageContentClass[];
  /**
   * When the node is unavailable, may a node-preferring file fall back to the
   * hosted database (within the cloud-safe size limit)? false = refuse.
   */
  cloudFallback: boolean;
};

/**
 * What the cloud actually knows about the org's best upload-capable node.
 * Every field is real: liveness derives from last_heartbeat_at, disk numbers
 * are the node's own last report (null until the first heartbeat).
 */
export type CandidateNode = {
  id: string;
  name: string;
  liveness: NodeLiveness;
  lastHeartbeatAt: string | null;
  /** Reachable URL the team configured; null = the browser cannot reach it. */
  baseUrl: string | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
};

export type StorageDestination = "node" | "cloud" | "refused";

export type StorageRouteDecision =
  | {
      destination: "node";
      nodeId: string;
      nodeName: string;
      /** Human sentence: WHY this file goes to the node. */
      reason: string;
    }
  | {
      destination: "cloud";
      /** True when the file preferred the node but honestly fell back. */
      fallback: boolean;
      reason: string;
    }
  | {
      destination: "refused";
      reason: string;
    };

export type StoragePlanFile = {
  name: string;
  contentType: string;
  byteSize: number;
};

export type StoragePlanEntry = {
  name: string;
  byteSize: number;
  contentClass: StorageContentClass;
  decision: StorageRouteDecision;
};

/** Response of POST /api/storage/plan — the pre-upload "no surprises" view. */
export type StoragePlanResult = {
  orgId: string;
  cloudCapBytes: number;
  policy: StorageRoutingPolicy;
  node: CandidateNode | null;
  entries: StoragePlanEntry[];
};

export type StorageUsage = {
  /** Real SUM(byte_size) of ready in-database rows (library + media). */
  cloudBytes: number;
  cloudItemCount: number;
  /** Real SUM(byte_size) of node-registered rows the nodes report as stored. */
  nodeBytes: number;
  nodeItemCount: number;
};

/** Response of GET /api/storage/policy — drives the /team/storage policy panel. */
export type StoragePolicyView = {
  orgId: string;
  policy: StorageRoutingPolicy;
  /** True when a policy row exists (someone changed the defaults). */
  customized: boolean;
  canManage: boolean;
  cloudCapBytes: number;
  usage: StorageUsage;
};

/** A grant handed to the browser for one direct-to-node upload. */
export type StorageUploadTicket = {
  grantId: string;
  /** Signed token the node verifies offline; never the node's access key. */
  grantToken: string;
  nodeId: string;
  nodeName: string;
  /** Base URL of the node (https or localhost); endpoints hang off it. */
  nodeBaseUrl: string;
  sha256: string;
  maxBytes: number;
  expiresAt: string;
  /** Use the chunked /uploads protocol instead of one-shot PUT /items. */
  chunked: boolean;
  chunkBytes: number;
};
