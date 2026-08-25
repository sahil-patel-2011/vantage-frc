/**
 * Routing-policy defaults and normalization. Pure and client-safe.
 */

import {
  STORAGE_CONTENT_CLASSES,
  type StorageContentClass,
  type StorageRoutingPolicy,
} from "./types";

/** Files STRICTLY above 4 MiB prefer the node by default (see caps.ts). */
export const DEFAULT_NODE_THRESHOLD_BYTES = 4 * 1024 * 1024;

/** Video and CAD/archive payloads always prefer the node by default. */
export const DEFAULT_PREFER_NODE_CLASSES: StorageContentClass[] = ["video", "cad", "archive"];

export const MAX_NODE_THRESHOLD_BYTES = 1024 * 1024 * 1024 * 1024; // 1 TiB, schema ceiling

export function defaultRoutingPolicy(): StorageRoutingPolicy {
  return {
    nodeThresholdBytes: DEFAULT_NODE_THRESHOLD_BYTES,
    preferNodeClasses: [...DEFAULT_PREFER_NODE_CLASSES],
    cloudFallback: true,
  };
}

function isContentClass(value: unknown): value is StorageContentClass {
  return typeof value === "string" && (STORAGE_CONTENT_CLASSES as string[]).includes(value);
}

/**
 * Normalize untrusted policy input (API body or DB row) into a valid policy.
 * Unknown classes are dropped, the threshold is clamped, and anything
 * unusable falls back to the default rather than guessing.
 */
export function normalizeRoutingPolicy(input: unknown): StorageRoutingPolicy {
  const fallback = defaultRoutingPolicy();
  if (input == null || typeof input !== "object") return fallback;
  const body = input as Record<string, unknown>;

  let nodeThresholdBytes = fallback.nodeThresholdBytes;
  const rawThreshold = Number(body.nodeThresholdBytes);
  if (Number.isFinite(rawThreshold) && rawThreshold >= 0) {
    nodeThresholdBytes = Math.min(Math.round(rawThreshold), MAX_NODE_THRESHOLD_BYTES);
  }

  let preferNodeClasses = fallback.preferNodeClasses;
  if (Array.isArray(body.preferNodeClasses)) {
    const seen = new Set<StorageContentClass>();
    for (const entry of body.preferNodeClasses) {
      if (isContentClass(entry)) seen.add(entry);
    }
    preferNodeClasses = [...seen];
  }

  const cloudFallback = typeof body.cloudFallback === "boolean" ? body.cloudFallback : fallback.cloudFallback;

  return { nodeThresholdBytes, preferNodeClasses, cloudFallback };
}
