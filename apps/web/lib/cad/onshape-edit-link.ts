/**
 * Official Onshape document URLs for human edit in Vantage chrome.
 * Link-first: a pasted cad.onshape.com document is enough to open Edit in
 * Onshape. Never names OAuth, env vars, or CLI commands.
 */

import { parseOnshapeDocumentUrl } from "@vantage/cad/onshape-url-parse";

export const EDIT_IN_ONSHAPE = "Edit in Onshape";

export const CAD_PASTE_LINK_LABEL = "Paste an Onshape link";

export const CAD_PASTE_LINK_HINT =
  "Open the Part Studio tab in Onshape and paste that link. You can edit it here without exporting.";

export const ONSHAPE_EDIT_BOARD_TITLE = "Edit an Onshape document";

export const ONSHAPE_EDIT_BOARD_HINT =
  "Paste the document link. Vantage keeps the chrome; Edit in Onshape opens the live model.";

const DEMO_TOKEN = /demo/i;

export type OnshapeEditRef = {
  url: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
  note?: string;
};

function isOnshapeHost(host: string): boolean {
  const name = host.toLowerCase();
  return name === "cad.onshape.com" || name.endsWith(".onshape.com");
}

/** Canonical https document URL from real ids. Blank when the document id is missing. */
export function onshapeCanonicalHref(input: {
  documentId: string;
  workspaceId?: string;
  elementId?: string;
}): string {
  const documentId = String(input.documentId ?? "").trim();
  const workspaceId = String(input.workspaceId ?? "").trim();
  const elementId = String(input.elementId ?? "").trim();
  if (!documentId || DEMO_TOKEN.test(documentId)) return "";
  if (workspaceId && elementId) {
    return `https://cad.onshape.com/documents/${documentId}/w/${workspaceId}/e/${elementId}`;
  }
  if (workspaceId) return `https://cad.onshape.com/documents/${documentId}/w/${workspaceId}`;
  return `https://cad.onshape.com/documents/${documentId}`;
}

/**
 * Official Onshape document URL a person can edit.
 * Rejects non-Onshape hosts, DEMO links, and non-http(s) schemes.
 */
export function onshapeEditHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || DEMO_TOKEN.test(trimmed)) return null;
  try {
    const parsed = parseOnshapeDocumentUrl(trimmed);
    const href = onshapeCanonicalHref(parsed);
    if (!href) return null;
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!isOnshapeHost(url.hostname)) return null;
    return href;
  } catch {
    return null;
  }
}

/**
 * Official Onshape embed URL — the same document link Onshape's Share → Embed
 * dialog uses. Null when the paste is not a real Onshape document.
 */
export function onshapeEmbedHref(raw: string | null | undefined): string | null {
  return onshapeEditHref(raw);
}

export function onshapeEditLabel(title?: string | null): string {
  const name = title?.trim();
  return name ? `Edit ${name} in Onshape` : EDIT_IN_ONSHAPE;
}

/** Parse a pasted Onshape URL. Throws a student-readable error — never DEMO ids. */
export function parsePastedOnshapeLink(raw: string): OnshapeEditRef {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Paste an Onshape document link to continue.");
  }
  if (DEMO_TOKEN.test(trimmed)) {
    throw new Error("That link looks like a demo. Paste a real Onshape document link.");
  }
  const parsed = parseOnshapeDocumentUrl(trimmed);
  const url = onshapeCanonicalHref(parsed) || parsed.url;
  return {
    url,
    documentId: parsed.documentId,
    workspaceId: parsed.workspaceId,
    elementId: parsed.elementId,
    note: parsed.note,
  };
}
