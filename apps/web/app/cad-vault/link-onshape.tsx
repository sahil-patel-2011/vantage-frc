"use client";

import { useMemo, useState } from "react";
import { parseOnshapeDocumentUrl } from "@vantage/cad/onshape-url-parse";
import { FormGrid, FormRow, Panel } from "../../components/ui";
import { CAD_DOCUMENT_KINDS, cadKindLabel, type CadDocumentKind } from "../../lib/cad-vault/view";

/**
 * Drop in an Onshape link and keep it.
 *
 * The vault API has accepted an `externalUrl` since the table was created, but
 * nothing in the page ever let you paste one — so the only way to get a live
 * Onshape document into the team's list was to export a file first. This is
 * the missing door: paste the link, it is checked against the real Onshape URL
 * grammar (document / workspace / element ids), and a vault entry is created
 * with no bytes. From then on it is one click away for everyone, and the
 * assembly manual and CAD agent can find it by name.
 *
 * Nothing is fetched from Onshape here. Whether the link opens for a given
 * person is Onshape's sharing settings, not ours, and the panel says so.
 */
export function LinkOnshapePanel({
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
      return { ok: true as const, value: parseOnshapeDocumentUrl(url) };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "Not an Onshape link" };
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

  return (
    <Panel aria-label="Link an Onshape document" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Link an Onshape document</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Paste the link from your browser&rsquo;s address bar while the document is open. It is kept here with your
        other CAD so nobody has to go hunting for it — no export needed.
      </p>
      <FormRow label="Onshape link">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://cad.onshape.com/documents/…/w/…/e/…"
          disabled={busy || saving}
          spellCheck={false}
        />
      </FormRow>
      {parsed && !parsed.ok ? <p className="app-muted">{parsed.message}</p> : null}
      {parsed?.ok ? (
        <>
          <small className="app-muted">
            Document {parsed.value.documentId.slice(0, 8)}… · workspace{" "}
            {parsed.value.workspaceId ? `${parsed.value.workspaceId.slice(0, 8)}…` : "not in link"} · element{" "}
            {parsed.value.elementId ? `${parsed.value.elementId.slice(0, 8)}…` : "not in link"}
            {parsed.value.note ? ` — ${parsed.value.note}` : ""}
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
          {error ? <p className="app-muted" role="alert">{error}</p> : null}
          <div>
            <button type="button" className="app-button" disabled={busy || saving || !title.trim()} onClick={() => void save()}>
              {saving ? "Saving…" : "Keep this link"}
            </button>
          </div>
          <small className="app-muted">
            Whether the link opens for someone is Onshape&rsquo;s sharing setting, not Vantage&rsquo;s. Share the document
            with the team in Onshape too.
          </small>
        </>
      ) : null}
    </Panel>
  );
}
