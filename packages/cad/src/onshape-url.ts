import { listOnshapeDocuments, listOnshapeElements, type OnshapeHttp } from "./onshape";

const ONSHAPE_RE =
  /documents\/(?:d\/)?([0-9a-f]+)(?:\/(?:w|v|m)\/([0-9a-f]+))?(?:\/e\/([0-9a-f]+))?/i;

export type ParsedOnshapeUrl = {
  url: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
  note?: string;
};

export type BoundOnshapeDocument = ParsedOnshapeUrl & {
  documentName?: string;
  elementName?: string;
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

export function onshapeDocumentOpenUrl(input: {
  documentId: string;
  workspaceId?: string;
  elementId?: string;
}): string {
  const base = `https://cad.onshape.com/documents/${input.documentId}`;
  if (!input.workspaceId) return base;
  if (!input.elementId) return `${base}/w/${input.workspaceId}`;
  return `${base}/w/${input.workspaceId}/e/${input.elementId}`;
}

/**
 * Fill missing workspace / Part Studio ids from the live Onshape account
 * so a documents/<id> link is enough to bind.
 */
export async function resolveOnshapeBind(url: string, http: OnshapeHttp): Promise<BoundOnshapeDocument> {
  const parsed = parseOnshapeDocumentUrl(url);
  let workspaceId = parsed.workspaceId;
  let elementId = parsed.elementId;
  let documentName: string | undefined;
  let elementName: string | undefined;

  if (!workspaceId) {
    const docs = await listOnshapeDocuments(http, 40);
    const match = docs.find((doc) => doc.id === parsed.documentId);
    workspaceId = match?.defaultWorkspaceId ?? "";
    documentName = match?.name;
    if (!workspaceId) {
      throw new Error("Could not find a default workspace for that document. Open it in Onshape and paste the /w/…/e/… link.");
    }
  }

  if (!elementId) {
    const elements = await listOnshapeElements(http, parsed.documentId, workspaceId);
    const partStudio =
      elements.find((el) => /partstudio|part studio/i.test(el.elementType)) ??
      elements.find((el) => /partstudio|part studio/i.test(el.name)) ??
      elements[0];
    if (!partStudio?.id) {
      throw new Error("That workspace has no Part Studio to bind. Create one in Onshape, then paste the Part Studio URL.");
    }
    elementId = partStudio.id;
    elementName = partStudio.name;
  }

  return {
    url: onshapeDocumentOpenUrl({ documentId: parsed.documentId, workspaceId, elementId }),
    documentId: parsed.documentId,
    workspaceId,
    elementId,
    documentName,
    elementName,
  };
}
