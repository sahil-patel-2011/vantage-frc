/**
 * Student CAD document picker helpers — list, paste-link fallback, bind URL.
 * Safe for Client Components: parse lives in `@vantage/cad/onshape-url-parse`.
 * Never names OAuth, env vars, or CLI commands.
 */

import { parseOnshapeDocumentUrl } from "@vantage/cad/onshape-url-parse";
import { withOrgHref } from "../nav/product-nav";

export const ONSHAPE_STUDENT_PERMISSIONS =
  "Vantage can read and edit Onshape documents you pick.";

export const CAD_DOCUMENT_PICKER_TITLE = "Pick an Onshape document";

export const CAD_DOCUMENT_PICKER_HINT =
  "Choose a document from the list, or paste an Onshape link if the list is empty.";

export const CAD_PASTE_LINK_LABEL = "Paste an Onshape link";

export const CAD_PASTE_LINK_HINT =
  "Open the Part Studio tab in Onshape and paste that link. A link without a tab still works after you pick one here.";

export const CAD_DOCUMENT_BIND = "Use this document";

export const CAD_DOCUMENT_OPEN = "Open CAD";

export const CAD_DOCUMENT_CONNECT_FIRST = "Connect Onshape before picking a document.";

export const CAD_DOCUMENT_LIST_EMPTY =
  "No documents came back. Paste an Onshape link instead.";

export const CAD_DOCUMENT_LIST_FAILED =
  "Could not list documents. Paste an Onshape link to continue.";

const DEMO_TOKEN = /demo/i;

export type ParsedPickerUrl = {
  url: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
  note?: string;
};

export function onshapePickerUrl(documentId: string, workspaceId?: string, elementId?: string): string {
  const doc = String(documentId ?? "").trim();
  const workspace = String(workspaceId ?? "").trim();
  const element = String(elementId ?? "").trim();
  if (!doc) return "";
  if (workspace && element) return `https://cad.onshape.com/documents/${doc}/w/${workspace}/e/${element}`;
  if (workspace) return `https://cad.onshape.com/documents/${doc}/w/${workspace}`;
  return `https://cad.onshape.com/documents/${doc}`;
}

/** Parse a pasted Onshape URL. Throws a student-readable error — never DEMO ids. */
export function parsePastedOnshapeLink(raw: string): ParsedPickerUrl {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Paste an Onshape document link to continue.");
  }
  if (DEMO_TOKEN.test(trimmed)) {
    throw new Error("That link looks like a demo. Paste a real Onshape document link.");
  }
  const parsed = parseOnshapeDocumentUrl(trimmed);
  return {
    url: parsed.url,
    documentId: parsed.documentId,
    workspaceId: parsed.workspaceId,
    elementId: parsed.elementId,
    note: parsed.note,
  };
}

export function cadOpenHref(orgId: string): string {
  return withOrgHref("/cad", orgId);
}

export function cadConnectionsHref(orgId: string | null): string {
  return withOrgHref("/cad/connections", orgId);
}

export async function bindOnshapeDocumentUrl(input: {
  orgId: string;
  url: string;
  signal?: AbortSignal;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const orgId = String(input.orgId ?? "").trim();
  const url = String(input.url ?? "").trim();
  if (!orgId) return { ok: false, error: "Choose your team first." };
  if (!url) return { ok: false, error: "Paste an Onshape document link to continue." };
  try {
    const response = await fetch("/api/cad/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "bind", url }),
      signal: input.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "Could not use that Onshape document.";
      return { ok: false, error };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "Timed out using that document. Try again." };
    }
    return { ok: false, error: "Could not reach the server to use that document." };
  }
}
