/**
 * Official Fusion share URLs for human edit in Vantage chrome.
 * Link-first: a pasted a360.co / Autodesk hub link is enough to open
 * Edit in Fusion. Never names OAuth, env vars, or CLI commands.
 * Fusion is not embedded here — Autodesk stays on this computer.
 */

import { parseFusionDocumentUrl } from "../cad-vault/cad-link";

export const EDIT_IN_FUSION = "Edit in Fusion";

export const FUSION_PASTE_LINK_LABEL = "Paste a Fusion link";

export const FUSION_PASTE_LINK_HINT =
  "Open the design in Fusion and paste the share link. You can edit it without exporting.";

export const FUSION_EDIT_BOARD_TITLE = "Edit a Fusion document";

export const FUSION_EDIT_BOARD_HINT =
  "Paste the share link. Vantage keeps the chrome; Edit in Fusion opens the live model on this computer.";

export const FUSION_PASTE_PLACEHOLDER = "https://a360.co/…";

const DEMO_TOKEN = /demo/i;

export type FusionEditRef = {
  url: string;
  host: string;
};

/**
 * Official Fusion share URL a person can edit.
 * Rejects non-Fusion hosts, DEMO links, and non-http(s) schemes.
 */
export function fusionEditHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || DEMO_TOKEN.test(trimmed)) return null;
  try {
    const parsed = parseFusionDocumentUrl(trimmed);
    const url = new URL(parsed.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return parsed.url;
  } catch {
    return null;
  }
}

export function fusionEditLabel(title?: string | null): string {
  const name = title?.trim();
  return name ? `Edit ${name} in Fusion` : EDIT_IN_FUSION;
}

/** Parse a pasted Fusion URL. Throws a student-readable error — never DEMO ids. */
export function parsePastedFusionLink(raw: string): FusionEditRef {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Paste a Fusion share link to continue.");
  }
  if (DEMO_TOKEN.test(trimmed)) {
    throw new Error("That link looks like a demo. Paste a real Fusion share link.");
  }
  return parseFusionDocumentUrl(trimmed);
}
