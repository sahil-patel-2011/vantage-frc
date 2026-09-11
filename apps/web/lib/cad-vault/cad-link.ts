import { parseOnshapeDocumentUrl } from "@vantage/cad/onshape-url-parse";

export type ParsedCadLink =
  | {
      kind: "onshape";
      url: string;
      documentId: string;
      workspaceId: string;
      elementId: string;
      note?: string;
    }
  | {
      kind: "fusion";
      url: string;
      host: string;
    };

function fusionHostAllowed(host: string): boolean {
  const name = host.toLowerCase();
  return (
    name === "a360.co" ||
    name === "www.a360.co" ||
    name === "fusion.autodesk.com" ||
    name === "myhub.autodesk360.com" ||
    name.endsWith(".autodesk360.com")
  );
}

/** Fusion share URL — a360.co / Autodesk hub. Not a marketing page. */
export function parseFusionDocumentUrl(raw: string): { url: string; host: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Not a Fusion link. Paste a share URL from Fusion that starts with https://");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Fusion links must start with https://");
  }
  if (!fusionHostAllowed(parsed.hostname)) {
    throw new Error("Not a Fusion link. Paste a share URL from Fusion (a360.co or Autodesk).");
  }
  if (parsed.pathname.replace(/\/+$/, "").length < 2) {
    throw new Error("That Fusion link is missing the document path.");
  }
  return { url: parsed.toString(), host: parsed.hostname };
}

/** Onshape document URL, else Fusion share URL. Throws when neither matches. */
export function parseCadExternalUrl(raw: string): ParsedCadLink {
  const trimmed = raw.trim();
  try {
    const onshape = parseOnshapeDocumentUrl(trimmed);
    return { kind: "onshape", ...onshape };
  } catch {
    // Fusion is the other CAD system of record.
  }
  try {
    const fusion = parseFusionDocumentUrl(trimmed);
    return { kind: "fusion", ...fusion };
  } catch {
    throw new Error("Paste an Onshape document link or a Fusion share link.");
  }
}

export function cadLinkKind(url: string | null | undefined): "onshape" | "fusion" | "other" {
  if (!url?.trim()) return "other";
  try {
    return parseCadExternalUrl(url).kind;
  } catch {
    return "other";
  }
}

/** Student-facing open label — title plus Onshape or Fusion, never "external source". */
export function cadLinkLabel(url: string, title?: string | null): string {
  const kind = cadLinkKind(url);
  const name = title?.trim();
  if (kind === "onshape") return name ? `Open ${name} in Onshape` : "Open in Onshape";
  if (kind === "fusion") return name ? `Open ${name} in Fusion` : "Open in Fusion";
  return name ? `Open ${name}` : "Open CAD link";
}
