"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "../../components/ui";
import { relativeTime } from "../../components/ui/relative-time";
import type { PublicPreview } from "../../lib/microsoft/run-import";
import type { MirrorSummary } from "../../lib/mirror/mirror-status";
import "./spreadsheet-mirror-card.css";

/**
 * Spreadsheet mirror: Google Sheets and Microsoft Excel as two identical, independently
 * hosted copies of the team's data.
 *
 * Vantage (Postgres) stays the source of truth. One sync writes both copies from one read;
 * one copy being down or throttled never stops the other; pulling edits reads both and
 * refuses to guess when two people changed the same cell differently. The card says which
 * copy holds what, in plain words, and only owners/admins see the buttons.
 */

type Copy = {
  copy: "excel" | "google";
  connected: boolean;
  lastSyncAt: string | null;
  lastSyncHash: string | null;
  lastReadAt: string | null;
  throttledUntil: string | null;
  lastError: string | null;
  fileUrl: string | null;
  fileName: string | null;
  account: string | null;
};

type Status = {
  migrated: boolean;
  setupMessage: string | null;
  canManage: boolean;
  summary: MirrorSummary;
  copies: Copy[];
  providers: {
    google: { configured: boolean; message: string | null; missingEnv: string[]; callbackUrl: string | null };
    excel: { configured: boolean; message: string | null; missingEnv: string[] };
  };
};

type Conflict = {
  entity: string;
  rowId: string;
  label: string;
  field: string;
  values: Array<{ copy: "excel" | "google"; value: string | number | boolean | null }>;
};

type ImportView = {
  preview: PublicPreview;
  conflicts: Conflict[];
  read: Array<"excel" | "google">;
  notice: string | null;
};

const LABEL = { excel: "Microsoft Excel", google: "Google Sheets" } as const;

const HEALTH_BADGE: Record<MirrorSummary["copies"][number]["health"], { tone: "good" | "info" | "setup" | "error" | "neutral"; label: string }> = {
  in_sync: { tone: "good", label: "Up to date" },
  behind: { tone: "info", label: "Catching up" },
  resting: { tone: "info", label: "Resting" },
  attention: { tone: "error", label: "Needs attention" },
  never_synced: { tone: "setup", label: "Not synced yet" },
  not_connected: { tone: "neutral", label: "Not connected" },
};

const CALLBACK_REASONS: Record<string, string> = {
  denied: "Google sign-in was cancelled or refused.",
  setup_required: "Google Sheets is not set up on this server yet.",
  api_disabled: "The Google Sheets API is not enabled on this server's Google Cloud project.",
  no_offline_access: "Google did not grant offline access, so Vantage could not keep the spreadsheet updated. Connect again.",
  not_migrated: "This server needs a database update before Google Sheets can be connected.",
  state_expired: "That Connect link expired. Start Connect again.",
  encryption: "Key encryption is not configured on this server, so the Google sign-in cannot be stored.",
  not_manager: "Only a team owner or admin can connect Google Sheets.",
};

function cellText(value: string | number | boolean | null): string {
  if (value === null || value === "") return "(blank)";
  return String(value);
}

export default function SpreadsheetMirrorCard({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sync" | "preview" | "apply" | "disconnect" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [importView, setImportView] = useState<ImportView | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/integrations/mirror/status?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as (Status & { error?: string }) | null;
      if (!response.ok || !data || !("summary" in data)) {
        setLoadError(data?.error ?? "Could not load the spreadsheet copies.");
        return;
      }
      setStatus(data);
      setLoadError(null);
    } catch {
      setLoadError("Could not load the spreadsheet copies. Check your connection and reload.");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
    // Back from Google's consent screen: say how it went.
    const params = new URLSearchParams(window.location.search);
    const google = params.get("google");
    if (google === "connected") setMessage({ ok: true, text: "Google Sheets connected. Sync both copies to fill it." });
    if (google === "error") {
      const reason = params.get("reason") ?? "";
      setMessage({ ok: false, text: CALLBACK_REASONS[reason] ?? "Connecting Google Sheets failed. Try again." });
    }
  }, [load]);

  async function post(url: string, body: unknown, method = "POST") {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, data };
  }

  async function syncBoth() {
    setBusy("sync");
    setMessage(null);
    const { ok, data } = await post("/api/integrations/mirror/sync", { orgId }).catch(() => ({ ok: false, data: {} as Record<string, unknown> }));
    const copies = (data.copies as Array<{ copy: "excel" | "google"; status: string; error: string | null }> | undefined) ?? [];
    if (!ok) {
      setMessage({ ok: false, text: typeof data.error === "string" ? data.error : "The sync failed. Try again." });
    } else {
      const done = copies.filter((copy) => copy.status === "succeeded").map((copy) => LABEL[copy.copy]);
      const behind = copies.filter((copy) => copy.status !== "succeeded");
      setMessage({
        ok: behind.length === 0,
        text:
          behind.length === 0
            ? `${done.join(" and ")} updated — ${done.length > 1 ? "both copies are identical" : "copy is up to date"}.`
            : `${done.length ? `${done.join(" and ")} updated. ` : ""}${behind
                .map((copy) => `${LABEL[copy.copy]}: ${copy.error ?? "did not update"}`)
                .join(" ")}`,
      });
    }
    setBusy(null);
    void load();
  }

  async function previewImport() {
    setBusy("preview");
    setMessage(null);
    const { ok, data } = await post("/api/integrations/mirror/import", { orgId, action: "preview" }).catch(() => ({
      ok: false,
      data: {} as Record<string, unknown>,
    }));
    if (!ok || !data.preview) {
      setMessage({ ok: false, text: typeof data.error === "string" ? data.error : "Could not read the spreadsheets." });
    } else {
      setImportView({
        preview: data.preview as PublicPreview,
        conflicts: (data.conflicts as Conflict[]) ?? [],
        read: (data.read as ImportView["read"]) ?? [],
        notice: typeof data.notice === "string" ? data.notice : null,
      });
    }
    setBusy(null);
    void load();
  }

  async function applyImport() {
    if (!importView) return;
    const changeIds = importView.preview.tables.flatMap((table) => table.changes.map((change) => change.id));
    setBusy("apply");
    const { ok, data } = await post("/api/integrations/mirror/import", { orgId, action: "apply", changeIds }).catch(() => ({
      ok: false,
      data: {} as Record<string, unknown>,
    }));
    const result = data.result as { status?: string; applied?: number } | undefined;
    setMessage(
      ok && result?.status === "applied"
        ? { ok: true, text: `Applied ${result.applied ?? changeIds.length} change${(result.applied ?? changeIds.length) === 1 ? "" : "s"} from the spreadsheets. Sync both to make the copies identical again.` }
        : { ok: false, text: typeof data.error === "string" ? data.error : "Nothing was applied. Preview again and retry." },
    );
    setImportView(null);
    setBusy(null);
    void load();
  }

  async function disconnectGoogle() {
    setBusy("disconnect");
    const { ok } = await post("/api/integrations/google/disconnect", { orgId }, "DELETE").catch(() => ({ ok: false }));
    setMessage(ok ? { ok: true, text: "Google Sheets disconnected. The spreadsheet stays in your Drive." } : { ok: false, text: "Could not disconnect. Try again." });
    setBusy(null);
    void load();
  }

  const summary = status?.summary;
  const bothConnected = (summary?.connected ?? 0) === 2;
  const anyConnected = (summary?.connected ?? 0) > 0;
  const changeCount = importView?.preview.totals.changes ?? 0;

  return (
    <section id="spreadsheet-mirror" className="app-card soft-panel connector-card mirror-card" aria-labelledby="mirror-title">
      <div className="connector-head">
        <div className="connector-identity">
          <h2 id="mirror-title">Spreadsheet copies</h2>
          {summary ? (
            <Badge tone={summary.identical ? "good" : anyConnected ? "info" : "neutral"}>
              {summary.identical ? "Identical" : anyConnected ? "Syncing" : "Off"}
            </Badge>
          ) : null}
        </div>
        <p className="connector-detail">
          Two live copies of your roster, matches, scouting and pick list — one in Google Sheets, one in Microsoft Excel —
          written from Vantage together so they always say the same thing. If one provider is down or asks Vantage to slow
          down, the other keeps working and the first catches up on the next sync. Match and team data comes from
          Vantage&apos;s own The Blue Alliance cache, so the copies add no TBA calls.
        </p>
      </div>

      {message ? (
        <p className={`connector-message${message.ok ? " success" : ""}`} role="status">
          {message.text}
        </p>
      ) : null}

      {!status ? (
        <p className="app-muted">{loadError ?? "Loading…"}</p>
      ) : !status.migrated ? (
        <p className="connector-status-line">{status.setupMessage}</p>
      ) : (
        <>
          <p className="mirror-headline">{summary?.headline}</p>
          <ul className="mirror-copies">
            {status.copies.map((copy) => {
              const health = summary?.copies.find((entry) => entry.copy === copy.copy);
              const badge = HEALTH_BADGE[health?.health ?? "not_connected"];
              const provider = status.providers[copy.copy];
              return (
                <li key={copy.copy} className={`mirror-copy mirror-copy--${copy.copy}`} data-health={health?.health}>
                  <header>
                    <strong>{LABEL[copy.copy]}</strong>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </header>
                  {copy.connected ? (
                    <dl>
                      <div>
                        <dt>Last synced</dt>
                        <dd>{copy.lastSyncAt ? relativeTime(copy.lastSyncAt) : "Never"}</dd>
                      </div>
                      <div>
                        <dt>Content</dt>
                        <dd>
                          <code title="Two copies with the same code hold the same data">{copy.lastSyncHash ? copy.lastSyncHash.slice(0, 8) : "—"}</code>
                        </dd>
                      </div>
                      {copy.account ? (
                        <div>
                          <dt>Account</dt>
                          <dd>{copy.account}</dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                  {health && health.health !== "in_sync" && health.health !== "not_connected" ? (
                    <p className="mirror-copy-note">{health.detail}</p>
                  ) : null}
                  <div className="mirror-copy-actions">
                    {copy.fileUrl ? (
                      <Button as="a" variant="ghost" size="sm" href={copy.fileUrl} target="_blank" rel="noreferrer">
                        Open {copy.copy === "excel" ? "workbook" : "spreadsheet"}
                      </Button>
                    ) : null}
                    {!copy.connected && status.canManage && provider.configured ? (
                      <Button
                        as="a"
                        variant="secondary"
                        size="sm"
                        href={
                          copy.copy === "google"
                            ? `/api/integrations/google/connect?orgId=${encodeURIComponent(orgId)}`
                            : `/api/integrations/microsoft/connect?orgId=${encodeURIComponent(orgId)}`
                        }
                      >
                        Connect {LABEL[copy.copy]}
                      </Button>
                    ) : null}
                    {copy.copy === "google" && copy.connected && status.canManage ? (
                      <Button variant="ghost" size="sm" type="button" disabled={busy !== null} onClick={() => void disconnectGoogle()}>
                        Disconnect
                      </Button>
                    ) : null}
                  </div>
                  {!provider.configured && status.canManage ? (
                    <div className="mirror-setup">
                      <p>{provider.message}</p>
                      {provider.missingEnv.length ? (
                        <p>
                          Missing: {provider.missingEnv.map((name) => <code key={name}>{name}</code>)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {copy.copy === "google" && !copy.connected && status.canManage && status.providers.google.callbackUrl ? (
                    <details className="mirror-setup">
                      <summary>One-time Google Cloud setup</summary>
                      <ol>
                        <li>Enable the Google Sheets API on the project that holds Vantage&apos;s Google sign-in client.</li>
                        <li>
                          Add this authorized redirect URI to that OAuth client: <code>{status.providers.google.callbackUrl}</code>
                        </li>
                      </ol>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {status.canManage && anyConnected ? (
            importView ? (
              <div className="mirror-import">
                <p className="mirror-import-head">
                  Read {importView.read.map((copy) => LABEL[copy]).join(" and ")}:{" "}
                  <strong>
                    {changeCount} change{changeCount === 1 ? "" : "s"}
                  </strong>{" "}
                  ready to bring into Vantage
                  {importView.conflicts.length
                    ? `, ${importView.conflicts.length} left alone because the two copies disagree`
                    : ""}
                  .
                </p>
                {importView.notice ? <p className="app-muted">{importView.notice}</p> : null}
                {importView.conflicts.length ? (
                  <ul className="mirror-conflicts">
                    {importView.conflicts.slice(0, 20).map((conflict) => (
                      <li key={`${conflict.entity}-${conflict.rowId}-${conflict.field}`}>
                        <strong>{conflict.label}</strong> · {conflict.field.replace(/^data\./, "")}:{" "}
                        {conflict.values.map((entry) => `${LABEL[entry.copy]} says ${cellText(entry.value)}`).join(", ")}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="connector-actions">
                  <Button variant="primary" type="button" disabled={busy !== null || changeCount === 0} onClick={() => void applyImport()}>
                    {busy === "apply" ? "Applying…" : changeCount ? `Apply ${changeCount} change${changeCount === 1 ? "" : "s"}` : "Nothing to apply"}
                  </Button>
                  <Button variant="ghost" type="button" disabled={busy !== null} onClick={() => setImportView(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="connector-actions">
                <Button variant="primary" type="button" disabled={busy !== null} onClick={() => void syncBoth()}>
                  {busy === "sync" ? "Syncing…" : bothConnected ? "Sync both copies" : "Sync now"}
                </Button>
                <Button variant="secondary" type="button" disabled={busy !== null} onClick={() => void previewImport()}>
                  {busy === "preview" ? "Reading…" : "Pull edits from the spreadsheets"}
                </Button>
              </div>
            )
          ) : null}
        </>
      )}
    </section>
  );
}
