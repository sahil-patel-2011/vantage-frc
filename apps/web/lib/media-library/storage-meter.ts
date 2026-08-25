/**
 * Honest storage meter. Reads real byte sums that the caller computed with
 * SUM(byte_size) — never a projected quota, never invented headroom.
 */

import type { MediaStorageMeter } from "./types";
import { formatMediaBytes } from "./validation";

export type StorageMeterInput = {
  /** SUM(byte_size) of ready in-database library items. */
  dbBytes: number;
  dbItemCount: number;
  /** SUM(byte_size) of node-hosted metadata rows (bytes live on the node). */
  nodeBytes: number;
  nodeItemCount: number;
};

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function computeStorageMeter(input: StorageMeterInput): MediaStorageMeter {
  const dbBytes = nonNegative(input.dbBytes);
  const dbItemCount = Math.round(nonNegative(input.dbItemCount));
  const nodeBytes = nonNegative(input.nodeBytes);
  const nodeItemCount = Math.round(nonNegative(input.nodeItemCount));

  const headline =
    dbItemCount === 0
      ? "Nothing stored in the team database yet"
      : `${formatMediaBytes(dbBytes)} in the team database across ${dbItemCount} ${
          dbItemCount === 1 ? "item" : "items"
        }`;

  const hint =
    nodeItemCount > 0
      ? `${formatMediaBytes(nodeBytes)} more lives on your storage node (${nodeItemCount} ${
          nodeItemCount === 1 ? "item" : "items"
        }).`
      : "Pair a storage node to grow beyond database storage.";

  return { dbBytes, dbItemCount, nodeBytes, nodeItemCount, headline, hint };
}
