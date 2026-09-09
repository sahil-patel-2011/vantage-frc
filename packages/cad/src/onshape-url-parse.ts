// The Onshape document-URL grammar, on its own so a browser bundle can import it.
// `onshape-url.ts` (OAuth-backed bind/open helpers) and `index.ts` pull in
// node:crypto; this file must stay dependency-free.

const ONSHAPE_RE =
  /documents\/(?:d\/)?([0-9a-f]+)(?:\/(?:w|v|m)\/([0-9a-f]+))?(?:\/e\/([0-9a-f]+))?/i;

export type ParsedOnshapeUrl = {
  url: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
  note?: string;
};

/** Same URL grammar as Claude-CodeCad: documents/<id>/w/<workspace>/e/<element>. */
export function parseOnshapeDocumentUrl(raw: string): ParsedOnshapeUrl {
  const url = raw.trim();
  const match = ONSHAPE_RE.exec(url);
  if (!match) {
    throw new Error(
      "Not an Onshape document URL. Paste a link like https://cad.onshape.com/documents/<id>/w/<workspace>/e/<element>",
    );
  }
  const documentId = match[1]!;
  const workspaceId = match[2] ?? "";
  const elementId = match[3] ?? "";
  const parsed: ParsedOnshapeUrl = { url, documentId, workspaceId, elementId };
  if (!workspaceId) {
    parsed.note = "No workspace in URL. Open the Part Studio tab and paste that link, or Bind will pick the default workspace.";
  }
  return parsed;
}
