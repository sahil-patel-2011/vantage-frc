/**
 * Browser-side direct-to-node upload driver. Client-safe (fetch + Blob only,
 * injectable for tests). The bytes go straight from the browser to the team's
 * storage node using the signed grant — they never transit the hosted app.
 *
 * Small files: one-shot PUT /items/<sha256> (the node hash-verifies).
 * Large files (ticket.chunked): the resumable protocol —
 *   POST  /uploads/<sha>   declare total length, learn the current offset
 *   PATCH /uploads/<sha>   append one chunk at `upload-offset`
 *   HEAD  /uploads/<sha>   re-learn the offset after a dropped connection
 * A 2 GB upload that dies at 90% resumes from the node's confirmed offset —
 * it never restarts. The final chunk triggers the node's sha256 verification;
 * a mismatch stores nothing.
 */

import type { StorageUploadTicket } from "./types";

export type NodeUploadResult =
  | { ok: true; alreadyStored: boolean }
  | { ok: false; error: string; retryable: boolean };

export type NodeUploadOptions = {
  fetchImpl?: typeof fetch;
  /** Called with bytes confirmed by the node so far. */
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  /** Network-level retries per chunk before giving up. */
  maxRetries?: number;
};

async function errorFrom(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* non-JSON body */
  }
  return `${fallback} (HTTP ${response.status})`;
}

function itemUrl(ticket: StorageUploadTicket): string {
  return `${ticket.nodeBaseUrl}/items/${ticket.sha256}`;
}

function uploadUrl(ticket: StorageUploadTicket): string {
  return `${ticket.nodeBaseUrl}/uploads/${ticket.sha256}`;
}

async function singleShotPut(
  ticket: StorageUploadTicket,
  blob: Blob,
  contentType: string,
  options: NodeUploadOptions,
): Promise<NodeUploadResult> {
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(itemUrl(ticket), {
      method: "PUT",
      headers: {
        authorization: `Bearer ${ticket.grantToken}`,
        "content-type": contentType || "application/octet-stream",
      },
      body: blob,
    });
  } catch {
    return {
      ok: false,
      retryable: true,
      error: `Could not reach ${ticket.nodeName} at ${ticket.nodeBaseUrl}. Check that the node is running and its URL is reachable from this network.`,
    };
  }
  if (response.status === 200 || response.status === 201) {
    let alreadyStored = false;
    try {
      alreadyStored = Boolean(((await response.json()) as { alreadyStored?: boolean }).alreadyStored);
    } catch {
      /* body optional */
    }
    options.onProgress?.(blob.size, blob.size);
    return { ok: true, alreadyStored };
  }
  return { ok: false, retryable: false, error: await errorFrom(response, "The storage node rejected the upload") };
}

/** Ask the node how many bytes it has safely stored for this sha. */
async function currentOffset(
  ticket: StorageUploadTicket,
  doFetch: typeof fetch,
): Promise<{ offset: number; complete: boolean } | null> {
  try {
    const response = await doFetch(uploadUrl(ticket), {
      method: "HEAD",
      headers: { authorization: `Bearer ${ticket.grantToken}` },
    });
    if (response.status === 404) return { offset: -1, complete: false };
    if (!response.ok) return null;
    if (response.headers.get("x-upload-complete") === "1") return { offset: 0, complete: true };
    const offset = Number(response.headers.get("upload-offset"));
    if (!Number.isInteger(offset) || offset < 0) return null;
    return { offset, complete: false };
  } catch {
    return null;
  }
}

async function chunkedUpload(
  ticket: StorageUploadTicket,
  blob: Blob,
  contentType: string,
  options: NodeUploadOptions,
): Promise<NodeUploadResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 3;

  // Declare (or resume) the session; the node answers with its offset.
  let offset: number;
  try {
    const start = await doFetch(uploadUrl(ticket), {
      method: "POST",
      headers: {
        authorization: `Bearer ${ticket.grantToken}`,
        "x-upload-length": String(blob.size),
        "x-upload-content-type": contentType || "application/octet-stream",
      },
    });
    if (!start.ok) {
      return { ok: false, retryable: false, error: await errorFrom(start, "The storage node refused to start the upload") };
    }
    const body = (await start.json()) as { alreadyStored?: boolean; offset?: number };
    if (body.alreadyStored) {
      options.onProgress?.(blob.size, blob.size);
      return { ok: true, alreadyStored: true };
    }
    offset = Number.isInteger(body.offset) ? Number(body.offset) : 0;
  } catch {
    return {
      ok: false,
      retryable: true,
      error: `Could not reach ${ticket.nodeName} at ${ticket.nodeBaseUrl}. Check that the node is running and its URL is reachable from this network.`,
    };
  }
  options.onProgress?.(offset, blob.size);

  let retriesLeft = maxRetries;
  while (offset < blob.size) {
    const chunk = blob.slice(offset, Math.min(offset + ticket.chunkBytes, blob.size));
    let response: Response;
    try {
      response = await doFetch(uploadUrl(ticket), {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${ticket.grantToken}`,
          "upload-offset": String(offset),
          "content-type": "application/offset+octet-stream",
        },
        body: chunk,
      });
    } catch {
      // Connection tore mid-chunk. Ask the node what it actually kept and
      // resume from there — this is the "dies at 90%, resumes" path.
      if (retriesLeft <= 0) {
        return {
          ok: false,
          retryable: true,
          error: `Lost the connection to ${ticket.nodeName} at ${Math.round((offset / blob.size) * 100)}% and retries ran out. The upload will resume from the node's last confirmed byte when you retry.`,
        };
      }
      retriesLeft -= 1;
      const probe = await currentOffset(ticket, doFetch);
      if (probe?.complete) return { ok: true, alreadyStored: false };
      if (probe && probe.offset >= 0) offset = probe.offset;
      continue;
    }

    if (response.status === 409) {
      // Offset drift (parallel tab, node restart): trust the node's number.
      const nodeOffset = Number(response.headers.get("upload-offset"));
      const body = (await response.json().catch(() => ({}))) as { offset?: number; error?: string };
      const corrected = Number.isInteger(nodeOffset) ? nodeOffset : Number(body.offset);
      if (Number.isInteger(corrected) && corrected >= 0 && corrected !== offset) {
        offset = corrected;
        continue;
      }
      return { ok: false, retryable: false, error: body.error ?? "The storage node rejected the chunk (offset conflict)." };
    }
    if (response.status === 200 || response.status === 201) {
      const body = (await response.json().catch(() => ({}))) as { offset?: number; byteSize?: number };
      if (response.status === 201) {
        options.onProgress?.(blob.size, blob.size);
        return { ok: true, alreadyStored: false };
      }
      offset = Number.isInteger(body.offset) ? Number(body.offset) : offset + chunk.size;
      retriesLeft = maxRetries;
      options.onProgress?.(offset, blob.size);
      continue;
    }
    return { ok: false, retryable: false, error: await errorFrom(response, "The storage node rejected a chunk") };
  }

  // Offset reached the total without a 201: the node holds all bytes but the
  // finalizing PATCH response was lost. Confirm via HEAD.
  const finalProbe = await currentOffset(ticket, doFetch);
  if (finalProbe?.complete) return { ok: true, alreadyStored: false };
  return {
    ok: false,
    retryable: true,
    error: "All bytes were sent but the storage node did not confirm completion. Retry to re-check.",
  };
}

/** Upload one blob per its ticket (one-shot or chunked). */
export async function uploadToNode(
  ticket: StorageUploadTicket,
  blob: Blob,
  contentType: string,
  options: NodeUploadOptions = {},
): Promise<NodeUploadResult> {
  if (blob.size > ticket.maxBytes) {
    return {
      ok: false,
      retryable: false,
      error: `File is ${blob.size} bytes but the upload grant covers ${ticket.maxBytes}. Re-select the file and try again.`,
    };
  }
  return ticket.chunked
    ? chunkedUpload(ticket, blob, contentType, options)
    : singleShotPut(ticket, blob, contentType, options);
}
