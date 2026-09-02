/**
 * Real file exports from a bound Part Studio: the bytes, not a 4,000-character
 * preview.
 *
 *  - STL is Onshape's synchronous export: one GET …/stl (binary, millimetres)
 *    which redirects to the file. fetch follows the redirect.
 *  - STEP goes through the asynchronous translation service: POST …/translations
 *    with storeInDocument=false, poll …/translations/{id} until DONE, then GET
 *    …/documents/d/{did}/externaldata/{id} for the bytes.
 *
 * Both return a Buffer plus a sha256 so the caller (the vault sink in the hosted
 * agent, a file on disk in the terminal) can dedupe and record provenance. Nothing
 * here decides where the bytes go.
 */

import { createHash } from "node:crypto";
import { readOnshapeJson, onshapeHttpError, type OnshapeKeyHttp } from "./onshape-api-keys";
import {
  onshapeExportFilename,
  onshapeExternalDataPath,
  onshapeStlExportPath,
  onshapeTranslationPayload,
  onshapeTranslationStatusPath,
  onshapeTranslationsPath,
  type OnshapeExportFileFormat,
} from "./onshape-features";

export type OnshapeExportedFile = {
  format: OnshapeExportFileFormat;
  filename: string;
  bytes: Buffer;
  byteLength: number;
  sha256: string;
  /** Present for STEP (translation service); absent for the synchronous STL route. */
  translationId?: string;
  exportedAt: string;
};

export type OnshapeExportOptions = {
  /** Human element name used for the filename (defaults to "part-studio"). */
  elementName?: string;
  pollMs?: number;
  maxPolls?: number;
  /** Injectable for tests so a poll loop does not really sleep. */
  sleep?: (ms: number) => Promise<void>;
};

const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function readBytes(response: Response, what: string): Promise<Buffer> {
  const contentType = response.headers.get("content-type") ?? "";
  if (/json/i.test(contentType)) {
    // Onshape reports export problems as a JSON body on a 200 in a few edge cases.
    const body = await readOnshapeJson(response).catch(() => null);
    throw new Error(`Onshape returned JSON instead of ${what} bytes: ${JSON.stringify(body ?? {}).slice(0, 300)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`Onshape returned an empty ${what} file. Is the Part Studio empty?`);
  if (bytes.length > MAX_EXPORT_BYTES) {
    throw new Error(`The ${what} export is ${Math.round(bytes.length / (1024 * 1024))} MB, over the 50 MB per-file limit.`);
  }
  return bytes;
}

function finish(format: OnshapeExportFileFormat, filename: string, bytes: Buffer, translationId?: string): OnshapeExportedFile {
  return {
    format,
    filename,
    bytes,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...(translationId ? { translationId } : {}),
    exportedAt: new Date().toISOString(),
  };
}

export async function exportOnshapeStl(
  http: OnshapeKeyHttp,
  document: { documentId: string; workspaceId: string; elementId: string },
  options: OnshapeExportOptions = {},
): Promise<OnshapeExportedFile> {
  const response = await http(onshapeStlExportPath(document), { headers: { accept: "*/*" } });
  if (!response.ok) {
    const body = await readOnshapeJson(response).catch(async () => null);
    throw onshapeHttpError(response.status, body ?? "STL export failed");
  }
  const bytes = await readBytes(response, "STL");
  return finish("stl", onshapeExportFilename(options.elementName, "stl"), bytes);
}

/**
 * Run one translation to completion and download its result. Exported so the
 * legacy job pipeline and the agent tool share the same poll/download rules.
 */
export async function exportOnshapeTranslation(
  http: OnshapeKeyHttp,
  document: { documentId: string; workspaceId: string; elementId: string },
  formatName: "STEP",
  options: OnshapeExportOptions = {},
): Promise<OnshapeExportedFile> {
  const sleep = options.sleep ?? defaultSleep;
  const pollMs = options.pollMs ?? 1_500;
  const maxPolls = options.maxPolls ?? 40;

  const started = await http(onshapeTranslationsPath(document), {
    method: "POST",
    body: JSON.stringify(onshapeTranslationPayload(formatName, document.documentId)),
  });
  const startedBody = (await readOnshapeJson(started)) as Record<string, unknown> | null;
  if (!started.ok) throw onshapeHttpError(started.status, startedBody);
  const translationId = String(startedBody?.id ?? startedBody?.translationId ?? "");
  if (!translationId) throw new Error("Onshape translation response missing id.");

  let requestState = String(startedBody?.requestState ?? "ACTIVE");
  let externalIds: string[] = Array.isArray(startedBody?.resultExternalDataIds)
    ? (startedBody!.resultExternalDataIds as unknown[]).map(String)
    : [];
  let failureReason = "";
  // A start response that already says DONE can still omit the external data ids,
  // so one status read is always allowed in that case.
  let polled = false;
  for (
    let i = 0;
    i < maxPolls && ((requestState !== "DONE" && requestState !== "FAILED") || (requestState === "DONE" && !externalIds.length && !polled));
    i++
  ) {
    if (polled || requestState !== "DONE") await sleep(pollMs);
    polled = true;
    const poll = await http(onshapeTranslationStatusPath(translationId));
    const body = (await readOnshapeJson(poll)) as Record<string, unknown> | null;
    if (!poll.ok) throw onshapeHttpError(poll.status, body);
    requestState = String(body?.requestState ?? "ACTIVE");
    if (Array.isArray(body?.resultExternalDataIds)) externalIds = (body!.resultExternalDataIds as unknown[]).map(String);
    if (typeof body?.failureReason === "string") failureReason = body.failureReason;
  }
  if (requestState !== "DONE") {
    throw new Error(
      `Onshape ${formatName} export did not finish (state=${requestState}${failureReason ? `: ${failureReason}` : ""}). Retry in a disposable document.`,
    );
  }
  const externalDataId = externalIds[0];
  if (!externalDataId) {
    throw new Error(`Onshape finished the ${formatName} translation but returned no external data id to download.`);
  }
  const download = await http(onshapeExternalDataPath(document.documentId, externalDataId), { headers: { accept: "*/*" } });
  if (!download.ok) {
    const body = await readOnshapeJson(download).catch(async () => null);
    throw onshapeHttpError(download.status, body ?? `${formatName} download failed`);
  }
  const bytes = await readBytes(download, formatName);
  return finish("step", onshapeExportFilename(options.elementName, "step"), bytes, translationId);
}

/** One entry point for the agent tools: pick the route by format. */
export async function exportOnshapeElementFile(
  http: OnshapeKeyHttp,
  document: { documentId: string; workspaceId: string; elementId: string },
  format: OnshapeExportFileFormat,
  options: OnshapeExportOptions = {},
): Promise<OnshapeExportedFile> {
  if (format === "stl") return exportOnshapeStl(http, document, options);
  return exportOnshapeTranslation(http, document, "STEP", options);
}

/** True when the bytes look like an ASCII STL, for a short honest preview line. */
export function looksLikeAsciiStl(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii").toLowerCase() === "solid";
}
