"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "../../components/ui";
import type { PublicPreview } from "../../lib/microsoft/run-import";
import "./microsoft-excel-card.css";

/**
 * Microsoft Excel (OneDrive) card on the Connectors page.
 *
 * Four honest states: the server has no Microsoft app registration (docs link), the team
 * has not connected, connected (account, workbook link, last sync, last error, history),
 * or the status could not be loaded. Only owners/admins see Connect / Sync now /
 * Import changes from Excel / Disconnect; the server enforces the same rule on every route.
 *
 * Import is two steps: a preview (nothing written) that replaces the action row, then one
 * primary "Apply N changes". The server re-reads the workbook on apply and skips anything
 * that moved on since the preview.
 */

const SHEET_LABEL: Record<PublicPreview["tables"][number]["entity"], string> = {
  PickList: "Pick list",
  MatchScouting: "Match scouting",
  PitScouting: "Pit scouting",
};

/** How many changes the preview lists before "and N more". */
const LISTED_CHANGES = 40;

function fieldName(field: string): string {
  return field.startsWith("data.") ? field.slice(5) : field;
}

function cellText(value: string | number | boolean | null): string {
  if (value === null || value === "") return "(blank)";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function ImportPreviewPanel({
  preview,
  busy,
  onApply,
  onClose,
}: {
  preview: PublicPreview;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const changes = preview.tables.flatMap((table) => table.changes);
  const conflicts = preview.tables.flatMap((table) => table.conflicts);
  const invalid = preview.tables.flatMap((table) => table.invalid);
  const readOnly = preview.tables.flatMap((table) => table.readOnlyEdits);
  const truncated = preview.tables.some((table) => table.truncatedLists);
  const t = preview.totals;

  const notImported: string[] = [];
  for (const table of preview.tables) {
    const sheet = SHEET_LABEL[table.entity];
    if (table.notice) notImported.push(`${sheet}: ${table.notice}`);
    if (table.unmatched) notImported.push(`${sheet}: ${plural(table.unmatched, "row does", "rows do")} not match anything in Vantage.`);
    if (table.withoutId) notImported.push(`${sheet}: ${plural(table.withoutId, "row has", "rows have")} no id, so ${table.withoutId === 1 ? "it was" : "they were"} ignored. Vantage does not add rows from Excel.`);
    if (table.duplicateIds) notImported.push(`${sheet}: ${plural(table.duplicateIds, "id appears", "ids appear")} more than once, so those rows were skipped.`);
    if (table.notInWorkbook) notImported.push(`${sheet}: ${plural(table.notInWorkbook, "row is", "rows are")} in Vantage but not in the workbook (deleted in Excel, or added since the last sync). Vantage does not delete rows from Excel.`);
    if (table.unknownColumns.length) notImported.push(`${sheet}: columns Vantage does not know were ignored (${table.unknownColumns.slice(0, 5).join(", ")}${table.unknownColumns.length > 5 ? ", …" : ""}).`);
  }
  for (const note of invalid) notImported.push(`${SHEET_LABEL[note.entity]} · ${note.label} · ${fieldName(note.field)}: ${note.reason}`);
  for (const note of readOnly) {
    notImported.push(`${SHEET_LABEL[note.entity]} · ${note.label} · ${fieldName(note.field)} is ${cellText(note.to)} in Excel, ${cellText(note.from)} in Vantage. ${note.reason}`);
  }

  const summary =
    t.changes === 0 && t.conflicts === 0
      ? "Nothing to import: the edits Vantage can take from Excel already match."
      : [
          t.changes > 0 ? `${plural(t.changes, "change is", "changes are")} ready to import.` : "No changes can be imported.",
          t.conflicts > 0
            ? `${plural(t.conflicts, "row was", "rows were")} left alone because ${t.conflicts === 1 ? "it" : "they"} changed in Vantage after the last sync.`
            : "",
        ]
          .filter(Boolean)
          .join(" ");

  return (
    <div className="ms-excel-import" role="region" aria-labelledby="ms-excel-import-title">
      <h3 id="ms-excel-import-title">Changes found in Excel</h3>
      <p className="ms-excel-small">{summary}</p>

      {changes.length > 0 ? (
        <ul className="ms-excel-change-list">
          {changes.slice(0, LISTED_CHANGES).map((change) => (
            <li key={change.id}>
              <span className="app-muted">
                {SHEET_LABEL[change.entity]} · {change.label}
              </span>{" "}
              <strong>{fieldName(change.field)}</strong>: {cellText(change.from)} → {cellText(change.to)}
            </li>
          ))}
          {changes.length > LISTED_CHANGES ? (
            <li className="app-muted">and {plural(changes.length - LISTED_CHANGES, "more change", "more changes")}</li>
          ) : null}
        </ul>
      ) : null}
      {truncated ? (
        <p className="app-muted ms-excel-small">This is a long list. Apply these, then import again for the rest.</p>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="ms-excel-conflicts">
          <h4>Left alone: changed in Vantage since the last sync</h4>
          <ul className="ms-excel-change-list">
            {conflicts.slice(0, LISTED_CHANGES).map((conflict) => (
              <li key={`${conflict.entity}:${conflict.rowId}`}>
                {SHEET_LABEL[conflict.entity]} · {conflict.label} ({conflict.fields.map(fieldName).join(", ")})
              </li>
            ))}
          </ul>
          <p className="app-muted ms-excel-small">Press Sync now, then redo these edits in Excel if they are still needed.</p>
        </div>
      ) : null}

      {notImported.length > 0 ? (
        <details className="ms-excel-skipped">
          <summary>Not imported ({notImported.length.toLocaleString()})</summary>
          <ul className="ms-excel-change-list">
            {notImported.slice(0, 100).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="connector-actions">
        {changes.length > 0 ? (
          <Button variant="primary" type="button" disabled={busy} onClick={onApply}>
            {busy ? "Applying…" : `Apply ${plural(changes.length, "change", "changes")}`}
          </Button>
        ) : null}
        <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>
          {changes.length > 0 ? "Cancel" : "Close"}
        </Button>
      </div>
    </div>
  );
}

type SyncRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "partial" | "failed";
  rowsWritten: number;
  error: string | null;
};

type StatusView = {
  configured: boolean;
  setupMessage: string | null;
  missingEnv: string[];
  callbackUrl: string | null;
  canManage: boolean;
  connected: boolean;
  connection: {
    accountName: string | null;
    accountEmail: string | null;
    workbookWebUrl: string | null;
    workbookName: string | null;
    connectedAt: string | null;
    lastSyncAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
  } | null;
  runs: SyncRun[];
};

const REASONS: Record<string, string> = {
  denied: "Microsoft sign-in was cancelled or not allowed.",
  state: "That sign-in link did not match this session. Start Connect again.",
  state_expired: "The sign-in took too long. Start Connect again.",
  setup_required: "This server has no Microsoft app registration yet.",
  encryption: "Key encryption is not configured on this server, so the Microsoft sign-in cannot be stored.",
  not_manager: "Only a team owner or admin can connect Microsoft.",
  not_member: "You are not a member of this team.",
  no_offline_access: "Microsoft did not grant offline access, so Vantage could not keep the workbook updated. Connect again and accept all permissions.",
  not_migrated: "This server needs a database update before Microsoft can be connected.",
  microsoft: "Microsoft returned an error. Try again in a few minutes.",
  missing_code: "Microsoft did not return a sign-in code. Start Connect again.",
  invalid_team: "Choose your team, then connect again.",
  failed: "Connecting failed. Try again.",
};

function when(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const RUN_LABEL: Record<SyncRun["status"], string> = {
  running: "Running",
  succeeded: "Synced",
  partial: "Partly synced",
  failed: "Failed",
};

export default function MicrosoftExcelCard({ orgId }: { orgId: string }) {
  const [view, setView] = useState<StatusView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sync" | "disconnect" | "preview" | "apply" | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [preview, setPreview] = useState<PublicPreview | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/integrations/microsoft/status?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as Partial<StatusView> & { error?: string };
      if (!response.ok) {
        setLoadError(body.error ?? "Could not load the Microsoft Excel status.");
        return;
      }
      setLoadError(null);
      setView(body as StatusView);
    } catch {
      setLoadError("Could not load the Microsoft Excel status.");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
    // The Connect flow lands back here with ?microsoft=connected|error&reason=…
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("microsoft");
    if (outcome === "connected") setMessage({ text: "Microsoft connected. Press Sync now to fill the workbook.", ok: true });
    if (outcome === "error") {
      setMessage({ text: REASONS[params.get("reason") ?? ""] ?? REASONS.failed!, ok: false });
    }
  }, [load]);

  async function syncNow() {
    setBusy("sync");
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/microsoft/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        status?: string;
        rowsWritten?: number;
        error?: string | null;
      };
      if (response.ok && body.status === "succeeded") {
        setMessage({ text: `Workbook updated — ${body.rowsWritten ?? 0} rows written.`, ok: true });
      } else {
        setMessage({ text: body.error ?? "The sync did not finish.", ok: false });
      }
    } catch {
      setMessage({ text: "Could not reach Vantage to start the sync.", ok: false });
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function previewImport() {
    setBusy("preview");
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/microsoft/import/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const body = (await response.json().catch(() => ({}))) as { preview?: PublicPreview; error?: string };
      if (response.ok && body.preview) setPreview(body.preview);
      else setMessage({ text: body.error ?? "Could not read the workbook.", ok: false });
    } catch {
      setMessage({ text: "Could not reach Vantage to read the workbook.", ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function applyImport() {
    if (!preview) return;
    const changeIds = preview.tables.flatMap((table) => table.changes.map((change) => change.id));
    setBusy("apply");
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/microsoft/import/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, changeIds }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        applied?: number;
        stale?: number;
        lateConflicts?: number;
        error?: string;
      };
      if (!response.ok) {
        setMessage({ text: body.error ?? "The import did not finish.", ok: false });
        return;
      }
      const applied = body.applied ?? 0;
      const leftAlone = (body.stale ?? 0) + (body.lateConflicts ?? 0);
      const parts = [
        applied > 0 ? `Imported ${plural(applied, "change", "changes")} from Excel.` : "No changes were imported.",
        leftAlone > 0
          ? `${plural(leftAlone, "change was", "changes were")} left alone because the workbook or Vantage changed after the preview.`
          : "",
        applied > 0 ? "Press Sync now to refresh the workbook." : "",
      ];
      setMessage({ text: parts.filter(Boolean).join(" "), ok: applied > 0 });
      setPreview(null);
    } catch {
      setMessage({ text: "Could not reach Vantage to apply the import.", ok: false });
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Microsoft? The workbook stays in OneDrive but stops updating.")) return;
    setBusy("disconnect");
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/microsoft/disconnect", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(
        response.ok
          ? { text: "Microsoft disconnected. The workbook is still in OneDrive.", ok: true }
          : { text: body.error ?? "Could not disconnect.", ok: false },
      );
    } catch {
      setMessage({ text: "Could not reach Vantage.", ok: false });
    } finally {
      setBusy(null);
      void load();
    }
  }

  const connection = view?.connection ?? null;
  const badge = !view
    ? { tone: "setup" as const, label: loadError ? "Unavailable" : "Loading" }
    : !view.configured && !view.connected
      ? { tone: "setup" as const, label: "Needs setup" }
      : view.connected
        ? connection?.lastError
          ? { tone: "error" as const, label: "Needs attention" }
          : { tone: "good" as const, label: "Connected" }
        : { tone: "neutral" as const, label: "Not connected" };

  return (
    <section id="microsoft-excel" className="app-card soft-panel connector-card ms-excel-card" aria-labelledby="ms-excel-title">
      <div className="connector-head">
        <div className="connector-identity">
          <h2 id="ms-excel-title">Microsoft Excel</h2>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
        <p className="connector-detail">
          Keeps a workbook in your team&apos;s OneDrive up to date with the event roster, matches, match and pit scouting,
          and the pick list — for coaches who live in Excel, and as a backup. Vantage stays the source of truth: each sync
          rewrites the Vantage sheets. Owners and admins can bring pick-list and scouting edits back with Import changes
          from Excel, after a preview.
        </p>
      </div>

      {message ? (
        <p className={`connector-message${message.ok ? " success" : ""}`} role="status">
          {message.text}
        </p>
      ) : null}

      {!view ? (
        <p className="app-muted">{loadError ?? "Loading…"}</p>
      ) : !view.configured && !view.connected ? (
        <>
          <p className="connector-status-line">{view.setupMessage ?? "Setup required."}</p>
          {view.canManage && view.missingEnv.length > 0 ? (
            <ul className="connector-env">
              {view.missingEnv.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          ) : null}
          {view.canManage && view.callbackUrl ? (
            <p className="app-muted ms-excel-small">
              Redirect URI to register: <code>{view.callbackUrl}</code>
            </p>
          ) : null}
          <p className="app-muted ms-excel-small">
            Setup guide: <code>docs/MICROSOFT_EXCEL.md</code>
          </p>
        </>
      ) : !view.connected ? (
        <>
          <p className="connector-status-line">Not connected.</p>
          {view.canManage ? (
            <div className="connector-actions">
              <Button
                as="a"
                variant="primary"
                href={`/api/integrations/microsoft/connect?orgId=${encodeURIComponent(orgId)}`}
              >
                Connect Microsoft
              </Button>
            </div>
          ) : (
            <p className="app-muted ms-excel-small">A team owner or admin can connect a Microsoft account.</p>
          )}
        </>
      ) : (
        <>
          <dl className="ms-excel-facts">
            <div>
              <dt>Account</dt>
              <dd>
                {connection?.accountName ?? "Microsoft account"}
                {connection?.accountEmail ? ` (${connection.accountEmail})` : ""}
              </dd>
            </div>
            <div>
              <dt>Workbook</dt>
              <dd>
                {connection?.workbookWebUrl ? (
                  <a href={connection.workbookWebUrl} target="_blank" rel="noopener noreferrer">
                    Open {connection.workbookName ?? "workbook"}
                  </a>
                ) : (
                  (connection?.workbookName ?? "Created on the next sync")
                )}
              </dd>
            </div>
            <div>
              <dt>Last sync</dt>
              <dd>{when(connection?.lastSyncAt ?? null)}</dd>
            </div>
            {connection?.lastError ? (
              <div className="ms-excel-error">
                <dt>Last problem</dt>
                <dd>
                  {connection.lastError} <span className="app-muted">({when(connection.lastErrorAt)})</span>
                </dd>
              </div>
            ) : null}
          </dl>

          {view.canManage && preview ? (
            <ImportPreviewPanel
              preview={preview}
              busy={busy === "apply"}
              onApply={() => void applyImport()}
              onClose={() => setPreview(null)}
            />
          ) : view.canManage ? (
            <div className="connector-actions">
              <Button variant="primary" type="button" disabled={busy !== null || !view.configured} onClick={() => void syncNow()}>
                {busy === "sync" ? "Syncing…" : "Sync now"}
              </Button>
              <Button variant="secondary" type="button" disabled={busy !== null || !view.configured} onClick={() => void previewImport()}>
                {busy === "preview" ? "Reading the workbook…" : "Import changes from Excel"}
              </Button>
              <Button variant="secondary" type="button" disabled={busy !== null} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
          ) : null}
          {!view.configured && view.setupMessage ? <p className="app-muted ms-excel-small">{view.setupMessage}</p> : null}

          {view.canManage && view.runs.length > 0 ? (
            <div className="ms-excel-runs">
              <h3>Recent syncs</h3>
              <ol>
                {view.runs.map((run) => (
                  <li key={run.id}>
                    <strong>{RUN_LABEL[run.status]}</strong> · {when(run.startedAt)} · {run.rowsWritten} rows
                    {run.error ? <span className="app-muted"> — {run.error}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
