"use client";

import { useState } from "react";
import { Button, Panel } from "../../components/ui";
import { cadLinkKind, cadLinkLabel } from "../../lib/cad-vault/cad-link";
import { fusionEditHref } from "../../lib/cad/fusion-edit-link";
import { onshapeEditHref } from "../../lib/cad/onshape-edit-link";
import { cadKindLabel, type CadDocumentSummary, type SubsystemOption } from "../../lib/cad-vault/view";
import { FusionEditButton } from "../cad/fusion-edit-board";
import { OnshapeDocumentEmbed, OnshapeEditButton } from "../cad/onshape-edit-board";
import { formatBytes, GeometrySummary, StoredVersionPreview } from "./cad-vault-preview";

function OnshapeCardPreview({
  kind,
  editHref,
  title,
}: {
  kind: ReturnType<typeof cadLinkKind>;
  editHref: string | null;
  title: string;
}) {
  switch (kind) {
    case "onshape":
      return editHref ? (
        <details className="onshape-edit-preview">
          <summary>View in Vantage</summary>
          <OnshapeDocumentEmbed url={editHref} title={title} />
        </details>
      ) : null;
    case "fusion":
    case "other":
      return null;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function DocumentCard({
  doc,
  subsystems,
  busy,
  onPatch,
  onRestore,
  onUploadVersion,
}: {
  doc: CadDocumentSummary;
  subsystems: SubsystemOption[];
  busy: boolean;
  onPatch: (documentId: string, payload: Record<string, unknown>) => void;
  onRestore: (documentId: string, version: number) => void;
  onUploadVersion: (documentId: string) => void;
}) {
  const [showVersions, setShowVersions] = useState(false);
  const latest = doc.latest;
  const onshapeHref = onshapeEditHref(doc.externalUrl);
  const fusionHref = fusionEditHref(doc.externalUrl);
  const linkKind = cadLinkKind(doc.externalUrl);

  return (
    <Panel aria-label={`Document ${doc.title}`} style={{ display: "grid", gap: 10, opacity: doc.status === "archived" ? 0.72 : 1 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: 0 }}>{doc.title}</h2>
          {onshapeHref ? (
            <p style={{ margin: "6px 0 0" }}>
              <OnshapeEditButton href={onshapeHref} title={doc.title} />
            </p>
          ) : fusionHref ? (
            <p style={{ margin: "6px 0 0" }}>
              <FusionEditButton href={fusionHref} title={doc.title} />
            </p>
          ) : doc.externalUrl ? (
            <p style={{ margin: "6px 0 0" }}>
              <Button as="a" variant="primary" href={doc.externalUrl} target="_blank" rel="noreferrer noopener">
                {cadLinkLabel(doc.externalUrl, doc.title)}
              </Button>
            </p>
          ) : null}
          <p className="app-muted" style={{ margin: "4px 0 0" }}>
            <span className="app-badge">{cadKindLabel(doc.kind)}</span>{" "}
            {doc.status !== "active" ? <span className="app-badge setup">{doc.status}</span> : null}{" "}
            <small>
              {doc.subsystemName ?? "No subsystem"} · v{doc.currentVersion} · {formatBytes(doc.totalBytes)} across {doc.versions.length} version
              {doc.versions.length === 1 ? "" : "s"}
            </small>
          </p>
          {doc.description ? (
            <p className="app-muted" style={{ margin: "4px 0 0" }}>
              <small>{doc.description}</small>
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {latest ? (
            <Button as="a" variant="secondary" href={`/api/cad-vault/file/${latest.publicId}`}>
              Download v{latest.version}
            </Button>
          ) : null}
          <Button variant="secondary" type="button" disabled={busy} onClick={() => onUploadVersion(doc.id)}>
            New version
          </Button>
        </div>
      </header>

      <OnshapeCardPreview kind={linkKind} editHref={onshapeHref} title={doc.title} />

      {latest ? (
        <div style={{ display: "grid", gap: 8 }}>
          <p className="app-muted" style={{ margin: 0 }}>
            <small>
              Latest: {latest.filename} · {latest.format.toUpperCase()} · {formatBytes(latest.byteSize)}
              {latest.changeNote ? ` · “${latest.changeNote}”` : ""}
            </small>
          </p>
          <GeometrySummary version={latest} />
          <StoredVersionPreview version={latest} />
        </div>
      ) : (
        <p className="app-muted" style={{ margin: 0 }}>
          <small>
            {doc.externalUrl
              ? linkKind === "fusion"
                ? "Linked live model — Edit in Fusion opens the document. Printable files are optional."
                : "Linked live model — Edit in Onshape opens the document. Printable files are optional."
              : "No file uploaded yet — this document is an empty shell."}
          </small>
        </p>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <small>Subsystem</small>
          <select
            value={doc.subsystemId ?? ""}
            disabled={busy}
            onChange={(event) => onPatch(doc.id, { subsystemId: event.target.value || null })}
          >
            <option value="">Unassigned</option>
            {subsystems.map((subsystem) => (
              <option key={subsystem.id} value={subsystem.id}>
                {subsystem.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            const next = window.prompt("Rename document", doc.title);
            if (next && next.trim() && next.trim() !== doc.title) onPatch(doc.id, { title: next.trim() });
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => onPatch(doc.id, { status: doc.status === "archived" ? "active" : "archived" })}
        >
          {doc.status === "archived" ? "Unarchive" : "Archive"}
        </button>
        {doc.versions.length > 0 ? (
          <button type="button" className="text-button" onClick={() => setShowVersions((prev) => !prev)}>
            {showVersions ? "Hide versions" : `Versions (${doc.versions.length})`}
          </button>
        ) : null}
      </div>

      {showVersions ? (
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }} aria-label={`Versions of ${doc.title}`}>
          {doc.versions.map((version) => (
            <li
              key={version.publicId}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: 8 }}
            >
              <div>
                <strong>v{version.version}</strong>{" "}
                <span className="app-muted">
                  <small>
                    {version.filename} · {version.format.toUpperCase()} · {formatBytes(version.byteSize)} ·{" "}
                    {new Date(version.createdAt).toLocaleString()}
                  </small>
                </span>
                {version.changeNote ? (
                  <p className="app-muted" style={{ margin: "2px 0 0" }}>
                    <small>“{version.changeNote}”</small>
                  </p>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Button as="a" variant="secondary" href={`/api/cad-vault/file/${version.publicId}`}>
                  Download
                </Button>
                {version.version !== doc.currentVersion ? (
                  <Button variant="secondary" type="button" disabled={busy} onClick={() => onRestore(doc.id, version.version)}>
                    Restore as new version
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </Panel>
  );
}
