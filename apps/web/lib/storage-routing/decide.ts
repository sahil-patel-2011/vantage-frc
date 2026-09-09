/**
 * The routing decision: given one file, the org's policy, the real state of
 * the org's best storage node, and the honest cloud cap, decide where the
 * bytes go — or refuse with a plain reason. Pure and deterministic so every
 * branch is unit-testable and the pre-upload plan shown to the user is the
 * SAME decision the server enforces.
 *
 * Honesty rules:
 * - Node liveness comes in pre-derived from last_heartbeat_at (0484 pattern);
 *   nothing here trusts a status column.
 * - A file is never routed to a node the browser cannot actually reach
 *   (no base URL, or a plain-http URL a https page cannot call).
 * - Falling back to the cloud is labelled as a fallback, with the reason,
 *   and only happens within the cloud-safe cap and when policy allows it.
 * - Refusals name the real numbers. Nothing is silently dropped.
 */

import { formatBytes } from "../storage-node";
import { contentClassFor } from "./classify";
import type {
  CandidateNode,
  ObjectStoreAvailability,
  StorageContentClass,
  StoragePlanEntry,
  StoragePlanFile,
  StorageRouteDecision,
  StorageRoutingPolicy,
} from "./types";

/** Keep this much of the node's reported free disk untouched. */
export const NODE_DISK_HEADROOM_BYTES = 256 * 1024 * 1024;

/**
 * Can a BROWSER on the (https) app origin reach this URL? Plain http is
 * blocked as mixed content except for localhost, so an http LAN address is
 * honestly "not reachable from the app" even though curl could hit it.
 */
export function isBrowserReachableUrl(baseUrl: string | null): boolean {
  if (!baseUrl) return false;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

export type NodeEligibility =
  | { eligible: true; node: CandidateNode & { baseUrl: string } }
  | { eligible: false; reason: string };

/** Why (or why not) this node can take an upload of `byteSize` right now. */
export function nodeEligibilityFor(node: CandidateNode | null, byteSize: number): NodeEligibility {
  if (!node) {
    return { eligible: false, reason: "No storage node is paired. Pair one on /team/storage." };
  }
  if (!node.baseUrl) {
    return {
      eligible: false,
      reason: `"${node.name}" has no reachable URL configured, so your browser cannot send it files. Set one on /team/storage (Cloudflare Tunnel or Tailscale).`,
    };
  }
  if (!isBrowserReachableUrl(node.baseUrl)) {
    return {
      eligible: false,
      reason: `"${node.name}" is configured with a plain-http address (${node.baseUrl}) that browsers on a secure page cannot call. Give it an https URL (Cloudflare Tunnel or Tailscale).`,
    };
  }
  if (node.liveness === "never") {
    return {
      eligible: false,
      reason: `"${node.name}" has never sent a heartbeat — it is paired but not running yet.`,
    };
  }
  if (node.liveness === "offline" || node.liveness === "degraded") {
    const lastSeen = node.lastHeartbeatAt
      ? `last heartbeat ${new Date(node.lastHeartbeatAt).toISOString()}`
      : "no heartbeat received";
    return {
      eligible: false,
      reason: `"${node.name}" looks ${node.liveness} (${lastSeen}).`,
    };
  }
  if (node.diskFreeBytes != null && byteSize + NODE_DISK_HEADROOM_BYTES > node.diskFreeBytes) {
    return {
      eligible: false,
      reason: `"${node.name}" reported only ${formatBytes(node.diskFreeBytes)} free — not enough for this ${formatBytes(byteSize)} file.`,
    };
  }
  return { eligible: true, node: { ...node, baseUrl: node.baseUrl } };
}

export type DecideInput = {
  byteSize: number;
  contentClass: StorageContentClass;
  policy: StorageRoutingPolicy;
  node: CandidateNode | null;
  cloudCapBytes: number;
  /**
   * Optional third destination: an S3-compatible object store the browser can
   * PUT to directly (Vantage Drive). Omit it and this function behaves exactly
   * as it did before object storage existed — the media library and resource
   * library callers do exactly that.
   *
   * Ordering, and why: the team's own node still wins when it can take the
   * file. A team that bought and ran hardware should have its bytes land
   * there, and it costs the org nothing per gigabyte. Object storage is the
   * next choice, because a 300 MB video has nowhere else to go. The hosted
   * database stays last for node-preferring files — it is the smallest and
   * most expensive of the three.
   */
  objectStore?: ObjectStoreAvailability;
};

/** The honest sentence for "object storage could have taken this, but…". */
function objectUnavailableNote(objectStore: ObjectStoreAvailability | undefined): string {
  if (!objectStore) return "";
  return objectStore.configured ? "" : ` ${objectStore.reason}`;
}

export function decideStorageRoute(input: DecideInput): StorageRouteDecision {
  const { byteSize, contentClass, policy, node, cloudCapBytes, objectStore } = input;
  const objectReady = objectStore?.configured === true;

  const overThreshold = byteSize > policy.nodeThresholdBytes;
  const classPrefersNode = policy.preferNodeClasses.includes(contentClass);
  const prefersNode = overThreshold || classPrefersNode;
  const fitsCloud = byteSize <= cloudCapBytes;

  const preferReason = overThreshold
    ? `${formatBytes(byteSize)} is over the ${formatBytes(policy.nodeThresholdBytes)} threshold`
    : `${contentClass} files always prefer the node`;

  if (prefersNode) {
    const eligibility = nodeEligibilityFor(node, byteSize);
    if (eligibility.eligible) {
      return {
        destination: "node",
        nodeId: eligibility.node.id,
        nodeName: eligibility.node.name,
        reason: preferReason,
      };
    }
    if (objectReady) {
      return {
        destination: "object",
        fallback: true,
        reason: `${eligibility.reason} Uploading straight to object storage instead — the bytes go from your browser to the bucket without passing through Vantage.`,
      };
    }
    if (fitsCloud && policy.cloudFallback) {
      return {
        destination: "cloud",
        fallback: true,
        reason: `${eligibility.reason} Storing in the team database instead (${formatBytes(byteSize)} fits the ${formatBytes(cloudCapBytes)} cloud limit).`,
      };
    }
    if (fitsCloud) {
      return {
        destination: "refused",
        reason: `${eligibility.reason} Your team's policy disables cloud fallback, so this upload is refused rather than silently rerouted.`,
      };
    }
    return {
      destination: "refused",
      reason: `${eligibility.reason} At ${formatBytes(byteSize)} it is also over the ${formatBytes(cloudCapBytes)} cloud upload limit, so there is nowhere honest to put it right now.${objectUnavailableNote(objectStore)}`,
    };
  }

  if (fitsCloud) {
    return {
      destination: "cloud",
      fallback: false,
      reason: `${formatBytes(byteSize)} fits the ${formatBytes(cloudCapBytes)} cloud limit`,
    };
  }

  // Under the threshold but over the cloud cap (possible when an admin raised
  // the threshold above the platform cap): the node — or object storage — is
  // the only honest home.
  const eligibility = nodeEligibilityFor(node, byteSize);
  if (eligibility.eligible) {
    return {
      destination: "node",
      nodeId: eligibility.node.id,
      nodeName: eligibility.node.name,
      reason: `${formatBytes(byteSize)} is over the ${formatBytes(cloudCapBytes)} cloud upload limit`,
    };
  }
  if (objectReady) {
    return {
      destination: "object",
      fallback: false,
      reason: `${formatBytes(byteSize)} is over the ${formatBytes(cloudCapBytes)} cloud upload limit, so it goes to object storage`,
    };
  }
  return {
    destination: "refused",
    reason: `${formatBytes(byteSize)} is over the ${formatBytes(cloudCapBytes)} cloud upload limit and the storage node cannot take it: ${eligibility.reason}${objectUnavailableNote(objectStore)}`,
  };
}

/**
 * Plan a whole selection of files at once (the pre-upload confirmation view).
 * `objectStore` is optional and trailing so the pre-existing three-argument
 * callers keep compiling and keep their exact behaviour.
 */
export function planFiles(
  files: StoragePlanFile[],
  policy: StorageRoutingPolicy,
  node: CandidateNode | null,
  cloudCapBytes: number,
  objectStore?: ObjectStoreAvailability,
): StoragePlanEntry[] {
  return files.map((file) => {
    const contentClass = contentClassFor(file.name, file.contentType);
    return {
      name: file.name,
      byteSize: file.byteSize,
      contentClass,
      decision: decideStorageRoute({
        byteSize: file.byteSize,
        contentClass,
        policy,
        node,
        cloudCapBytes,
        ...(objectStore ? { objectStore } : {}),
      }),
    };
  });
}
