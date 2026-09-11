"use client";

import { useMemo, useState } from "react";
import { FormGrid, FormRow, Panel, Button } from "../../components/ui";
import { parseCadExternalUrl } from "../../lib/cad-vault/cad-link";
import { fusionEditHref } from "../../lib/cad/fusion-edit-link";
import { onshapeEditHref } from "../../lib/cad/onshape-edit-link";
import { CAD_DOCUMENT_KINDS, cadKindLabel, type CadDocumentKind } from "../../lib/cad-vault/view";
import { FusionEditButton } from "../cad/fusion-edit-board";
import { OnshapeDocumentEmbed, OnshapeEditButton } from "../cad/onshape-edit-board";

/**
 * Drop in an Onshape or Fusion link and keep it by title.
 *
 * The vault API has accepted an `externalUrl` since the table was created.
 * Onshape uses the real document grammar; Fusion uses an Autodesk share URL.
 * Nothing is fetched here — whether the link opens is the CAD system's sharing.
 */
export function LinkCadPanel({
  orgId,
  seasonYear,
  subteams,
  busy,
  onCreated,
}: {
  orgId: string;
  seasonYear: number | null;
  subteams: Array<{ id: string; name: string }>;
  busy: boolean;
  onCreated: (title: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CadDocumentKind>("assembly");
  const [subsystemId, setSubsystemId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parsed = useMemo(() => {
    if (!url.trim()) return null;
    try {
      return { ok: true as const, value: parseCadExternalUrl(url) };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "Not an Onshape or Fusion link" };
    }
  }, [url]);

  async function save() {
    if (!parsed?.ok || !title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/cad-vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          title: title.trim(),
          seasonYear: seasonYear ?? undefined,
          kind,
          subsystemId: subsystemId || undefined,
          externalUrl: parsed.value.url,
        }),
      });
      const data = (await response.json()) as { documentId?: string; error?: string };
      if (!response.ok || !data.documentId) {
        setError(data.error ?? "Could not save the link.");
        return;
      }
      onCreated(title.trim());
      setUrl("");
      setTitle("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  const system = parsed?.ok ? (parsed.value.kind === "onshape" ? "Onshape" : "Fusion") : "CAD";
  const onshapeHref = parsed?.ok && parsed.value.kind === "onshape" ? onshapeEditHref(parsed.value.url) : null;
  const fusionHref = parsed?.ok && parsed.value.kind === "fusion" ? fusionEditHref(parsed.value.url) : null;
  const editHref = onshapeHref || fusionHref;

  return (
    <Panel id="link-cad" aria-label="Link an Onshape or Fusion document" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Link an Onshape or Fusion document</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Paste the link from the address bar while the document is open. It is kept here by title so nobody has to hunt
        for it — no export needed.
      </p>
      <FormRow label="Onshape or Fusion link">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://cad.onshape.com/documents/… or https://a360.co/…"
          disabled={busy || saving}
          spellCheck={false}
        />
      </FormRow>
      {parsed && !parsed.ok ? <p className="app-muted">{parsed.message}</p> : null}
      {parsed?.ok ? (
        <>
          <small className="app-muted">
            {parsed.value.kind === "onshape"
              ? `Onshape document ${parsed.value.documentId.slice(0, 8)}…${
                  parsed.value.note ? ` — ${parsed.value.note}` : ""
                }`
              : `Fusion share on ${parsed.value.host}`}
          </small>
          <FormGrid min={180}>
            <FormRow label="Title">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Intake assembly — 2026"
                maxLength={160}
                disabled={busy || saving}
              />
            </FormRow>
            <FormRow label="Kind">
              <select value={kind} onChange={(event) => setKind(event.target.value as CadDocumentKind)} disabled={busy || saving}>
                {CAD_DOCUMENT_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {cadKindLabel(value)}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Subsystem">
              <select value={subsystemId} onChange={(event) => setSubsystemId(event.target.value)} disabled={busy || saving}>
                <option value="">Unassigned</option>
                {subteams.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormRow>
          </FormGrid>
          {error ? (
            <p className="app-muted" role="alert">
              {error}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {onshapeHref ? <OnshapeEditButton href={onshapeHref} title={title || null} /> : null}
            {fusionHref ? <FusionEditButton href={fusionHref} title={title || null} /> : null}
            <Button
              variant={editHref ? "secondary" : "primary"}
              type="button"
              disabled={busy || saving || !title.trim()}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : `Keep this ${system} link`}
            </Button>
          </div>
          {onshapeHref ? <OnshapeDocumentEmbed url={onshapeHref} title={title || null} /> : null}
          <small className="app-muted">
            Whether the link opens for someone is {system}&rsquo;s sharing setting, not Vantage&rsquo;s. Share the document
            with the team there too.
          </small>
        </>
      ) : null}
    </Panel>
  );
}

/** @deprecated Use LinkCadPanel — Onshape and Fusion share the same paste field. */
export const LinkOnshapePanel = LinkCadPanel;
