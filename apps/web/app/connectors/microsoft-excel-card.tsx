"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "../../components/ui";
import "./microsoft-excel-card.css";

/**
 * Microsoft Excel (OneDrive) card on the Connectors page.
 *
 * Four honest states: the server has no Microsoft app registration (docs link), the team
 * has not connected, connected (account, workbook link, last sync, last error, history),
 * or the status could not be loaded. Only owners/admins see Connect / Sync now /
 * Disconnect; the server enforces the same rule on every route.
 */

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
  invalid_team: "Choose your team first.",
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
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

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
          rewrites the Vantage sheets, so edits made there do not flow back.
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

          {view.canManage ? (
            <div className="connector-actions">
              <Button variant="primary" type="button" disabled={busy !== null || !view.configured} onClick={() => void syncNow()}>
                {busy === "sync" ? "Syncing…" : "Sync now"}
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
