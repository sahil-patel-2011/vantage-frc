/**
 * The browser side of a Drive upload: ask where the file goes, send the bytes
 * the way that answer requires, then finalize.
 *
 * Kept out of the component so the sequencing is readable and so the honest
 * route label ("Going to your storage node", "Stored in Vantage", "Going to
 * hosted storage") comes from the same object that drives the transfer — the
 * user is never shown one destination and given another.
 *
 * Client-safe: fetch, Blob and the shared streaming hasher only.
 */

import { sha256HexOfBlob } from "../../lib/storage-routing/sha256-stream";
import { uploadToNode } from "../../lib/storage-routing/upload-client";
import type { StorageUploadTicket } from "../../lib/storage-routing/types";
import type { DriveScope } from "../../lib/drive/types";

export type UploadPhase = "hashing" | "routing" | "sending" | "finishing" | "done" | "failed";

export type UploadItem = {
  id: string;
  name: string;
  byteSize: number;
  phase: UploadPhase;
  /** 0..1, only meaningful while sending. */
  progress: number;
  /** The honest destination sentence, shown as soon as it is known. */
  routeLabel: string;
  reason: string;
  error: string | null;
  fileId: string | null;
};

export type UploadTarget = {
  orgId: string;
  scope: DriveScope;
  folderId: string | null;
};

type GrantResponse =
  | { destination: "refused"; reason: string }
  | { destination: "cloud"; fileId: string; reason: string; capBytes: number }
  | { destination: "node"; fileId: string; reason: string; alreadyStored: true }
  | {
      destination: "node";
      fileId: string;
      reason: string;
      alreadyStored: false;
      ticket: StorageUploadTicket;
    }
  | {
      destination: "object";
      fileId: string;
      reason: string;
      put: { url: string; expiresAt: string; headers: Record<string, string> };
    }
  | { error: string };

/** The sentence shown next to the file while it uploads. */
export function routeLabelFor(destination: string, nodeName?: string): string {
  if (destination === "node") return `Going to your storage node${nodeName ? ` (${nodeName})` : ""}`;
  if (destination === "object") return "Going to hosted storage";
  if (destination === "cloud") return "Stored in Vantage";
  return "Nowhere to put it";
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* non-JSON */
  }
  return `${fallback} (HTTP ${response.status})`;
}

/**
 * Upload one file. `onUpdate` is called at every phase change and on progress,
 * so the caller re-renders one row rather than the whole list.
 */
export async function uploadOneFile(
  file: File,
  target: UploadTarget,
  item: UploadItem,
  onUpdate: (patch: Partial<UploadItem>) => void,
): Promise<void> {
  try {
    onUpdate({ phase: "hashing", progress: 0 });
    // Hashed in the browser, streaming, so a 2 GB video does not have to be
    // held in memory twice — and so the server can verify that the bytes it
    // stores are the bytes the route was granted for.
    const sha256 = await sha256HexOfBlob(file, (hashed) =>
      onUpdate({ progress: file.size > 0 ? hashed / file.size : 0 }),
    );

    onUpdate({ phase: "routing" });
    const grantResponse = await fetch("/api/drive/upload/grant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId: target.orgId,
        scope: target.scope,
        folderId: target.folderId,
        name: file.name,
        contentType: file.type || "application/octet-stream",
        byteSize: file.size,
        sha256,
      }),
    });
    if (!grantResponse.ok) {
      onUpdate({ phase: "failed", error: await readError(grantResponse, "Could not start the upload") });
      return;
    }
    const grant = (await grantResponse.json()) as GrantResponse;
    if ("error" in grant) {
      onUpdate({ phase: "failed", error: grant.error });
      return;
    }
    if (grant.destination === "refused") {
      onUpdate({ phase: "failed", routeLabel: routeLabelFor("refused"), error: grant.reason });
      return;
    }

    onUpdate({
      phase: "sending",
      fileId: grant.fileId,
      reason: grant.reason,
      routeLabel: routeLabelFor(
        grant.destination,
        grant.destination === "node" && !grant.alreadyStored ? grant.ticket.nodeName : undefined,
      ),
    });

    if (grant.destination === "cloud") {
      const put = await fetch(
        `/api/drive/files/${grant.fileId}/content?orgId=${encodeURIComponent(target.orgId)}`,
        { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file },
      );
      if (!put.ok) {
        onUpdate({ phase: "failed", error: await readError(put, "The upload was refused") });
        return;
      }
      onUpdate({ phase: "done", progress: 1 });
      return;
    }

    if (grant.destination === "object") {
      // Straight from this browser to the bucket. If this fails with an opaque
      // network error it is almost always the bucket's CORS rules, so say that
      // rather than "upload failed".
      let put: Response;
      try {
        put = await fetch(grant.put.url, {
          method: "PUT",
          headers: grant.put.headers,
          body: file,
        });
      } catch {
        onUpdate({
          phase: "failed",
          error:
            "The browser could not reach the object store. That is usually the bucket's CORS rules — it has to allow PUT from this site.",
        });
        return;
      }
      if (!put.ok) {
        onUpdate({ phase: "failed", error: `The object store refused the upload (HTTP ${put.status}).` });
        return;
      }
      onUpdate({ phase: "finishing", progress: 1 });
      await finalize(target.orgId, grant.fileId, null, onUpdate);
      return;
    }

    // node
    if (grant.alreadyStored) {
      onUpdate({ phase: "done", progress: 1, reason: grant.reason });
      return;
    }
    const result = await uploadToNode(grant.ticket, file, file.type || "application/octet-stream", {
      onProgress: (sent, total) => onUpdate({ progress: total > 0 ? sent / total : 0 }),
    });
    if (!result.ok) {
      onUpdate({ phase: "failed", error: result.error });
      return;
    }
    onUpdate({ phase: "finishing", progress: 1 });
    await finalize(target.orgId, grant.fileId, grant.ticket.grantId, onUpdate);
  } catch (error) {
    onUpdate({
      phase: "failed",
      error: error instanceof Error ? error.message : "The upload could not be completed",
    });
  }
  void item;
}

async function finalize(
  orgId: string,
  fileId: string,
  grantId: string | null,
  onUpdate: (patch: Partial<UploadItem>) => void,
): Promise<void> {
  const response = await fetch("/api/drive/upload/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orgId, fileId, grantId }),
  });
  if (!response.ok) {
    onUpdate({
      phase: "failed",
      error: await readError(
        response,
        "The bytes arrived but Vantage could not mark the file finished. Retry to re-check.",
      ),
    });
    return;
  }
  onUpdate({ phase: "done" });
}
