"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui";
import {
  CAD_DOCUMENT_BIND,
  CAD_DOCUMENT_CONNECT_FIRST,
  CAD_DOCUMENT_LIST_EMPTY,
  CAD_DOCUMENT_LIST_FAILED,
  CAD_DOCUMENT_OPEN,
  CAD_DOCUMENT_PICKER_HINT,
  CAD_DOCUMENT_PICKER_TITLE,
  CAD_PASTE_LINK_HINT,
  CAD_PASTE_LINK_LABEL,
  bindOnshapeDocumentUrl,
  cadOpenHref,
  onshapePickerUrl,
  parsePastedOnshapeLink,
} from "../../../lib/cad/cad-document-picker";
import { listDocumentElements } from "../../../lib/cad/list-document-elements";
import {
  EMPTY_LISTED_DOCUMENTS,
  listOnshapeDocuments,
  type ListedOnshapeDocument,
} from "../../../lib/cad/list-onshape-documents";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";

type ListedTab = { id: string; name: string };

export default function CadDocumentPicker({
  orgId,
  connected,
}: {
  orgId: string;
  connected: boolean;
}) {
  const [documents, setDocuments] = useState<ListedOnshapeDocument[]>(EMPTY_LISTED_DOCUMENTS.documents);
  const [tabs, setTabs] = useState<ListedTab[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [elementId, setElementId] = useState("");
  const [paste, setPaste] = useState("");
  const [listMessage, setListMessage] = useState("");
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bound, setBound] = useState(false);

  const selected = documents.find((row) => row.id === documentId) ?? null;

  const loadDocuments = useCallback(async () => {
    if (!connected || !orgId) {
      setDocuments([]);
      setListMessage(connected ? "" : CAD_DOCUMENT_CONNECT_FIRST);
      return;
    }
    try {
      const listed = await listOnshapeDocuments({ orgId });
      setDocuments(listed.documents);
      setListMessage(listed.documents.length === 0 ? CAD_DOCUMENT_LIST_EMPTY : "");
    } catch {
      setDocuments([]);
      setListMessage(CAD_DOCUMENT_LIST_FAILED);
    }
  }, [connected, orgId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!connected || !orgId || !selected?.id || !selected.defaultWorkspaceId) {
      setTabs([]);
      setElementId("");
      return;
    }
    let cancelled = false;
    void listDocumentElements({
      orgId,
      documentId: selected.id,
      workspaceId: selected.defaultWorkspaceId,
    })
      .then((listed) => {
        if (cancelled) return;
        const next = listed.elements.map((element) => ({
          id: element.id,
          name: element.name || element.id,
        }));
        setTabs(next);
        setElementId((current) => (next.some((tab) => tab.id === current) ? current : next[0]?.id ?? ""));
      })
      .catch(() => {
        if (cancelled) return;
        setTabs([]);
        setElementId("");
      });
    return () => {
      cancelled = true;
    };
  }, [connected, orgId, selected]);

  function resolveUrl(): string {
    const pasted = paste.trim();
    if (pasted) {
      const parsed = parsePastedOnshapeLink(pasted);
      return onshapePickerUrl(parsed.documentId, parsed.workspaceId, parsed.elementId) || parsed.url;
    }
    if (!selected) {
      throw new Error("Choose a listed document, or paste an Onshape link.");
    }
    return onshapePickerUrl(selected.id, selected.defaultWorkspaceId, elementId);
  }

  async function useDocument() {
    setBusy(true);
    setMessage("");
    setMessageOk(false);
    setBound(false);
    try {
      const url = resolveUrl();
      const result = await bindOnshapeDocumentUrl({
        orgId,
        url,
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setBound(true);
      setMessageOk(true);
      setMessage("This document is ready in CAD.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not use that document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="app-card cad-document-picker" aria-label={CAD_DOCUMENT_PICKER_TITLE}>
      <header>
        <h2>{CAD_DOCUMENT_PICKER_TITLE}</h2>
        <p className="app-muted">{CAD_DOCUMENT_PICKER_HINT}</p>
      </header>

      {listMessage ? (
        <p className="app-muted" role="status">
          {listMessage}
        </p>
      ) : null}

      {documents.length > 0 ? (
        <label>
          Document
          <select
            value={documentId}
            disabled={busy || !connected}
            onChange={(event) => setDocumentId(event.target.value)}
          >
            <option value="">Choose a listed document</option>
            {documents.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {tabs.length > 0 ? (
        <label>
          Part Studio or assembly
          <select
            value={elementId}
            disabled={busy || !connected}
            onChange={(event) => setElementId(event.target.value)}
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label>
        {CAD_PASTE_LINK_LABEL}
        <small>{CAD_PASTE_LINK_HINT}</small>
        <input
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          placeholder="https://cad.onshape.com/documents/…"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
      </label>

      <div className="cad-document-picker-actions">
        <Button variant="primary" type="button" disabled={busy || !connected} onClick={() => void useDocument()}>
          {busy ? "Using…" : CAD_DOCUMENT_BIND}
        </Button>
        {bound ? (
          <Button as="a" variant="secondary" href={cadOpenHref(orgId)}>
            {CAD_DOCUMENT_OPEN}
          </Button>
        ) : null}
      </div>

      {message ? (
        <p role="status" className={messageOk ? "telemetry-status" : "app-muted"}>
          {message}
        </p>
      ) : null}
    </section>
  );
}
