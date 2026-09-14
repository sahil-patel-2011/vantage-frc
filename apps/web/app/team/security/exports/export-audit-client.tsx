"use client";

import { useEffect, useState } from "react";

type ExportEvent = {
  id: string;
  createdAt: string;
  action: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  jobId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  scope: string | null;
  status: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  "export.requested": "Export requested",
  "export.completed": "Export built",
  "export.downloaded": "Archive downloaded",
  "export.cancelled": "Export cancelled",
  "export.failed": "Export failed",
};

const actionColor = (action: string) =>
  action === "export.downloaded" ? "#ffb936" : action === "export.failed" ? "#ff6b6b" : undefined;

function detail(event: ExportEvent): string {
  const meta = event.metadata ?? {};
  const parts: string[] = [];
  const scope = event.scope ?? (typeof meta.scope === "string" ? meta.scope : null);
  if (scope) parts.push(scope === "private" ? "private scope" : "team scope");
  if (Array.isArray(meta.domains)) parts.push(`${(meta.domains as unknown[]).length} domains`);
  if (typeof meta.sizeBytes === "number") parts.push(`${(meta.sizeBytes / 1024).toFixed(0)} KB`);
  if (event.reason) parts.push(`“${event.reason}”`);
  return parts.join(" · ");
}

export default function ExportAuditClient({ orgId }: { orgId: string }) {
  const [events, setEvents] = useState<ExportEvent[]>([]);
  const [byAction, setByAction] = useState<Array<{ action: string; count: string }>>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await fetch(`/api/organizations/export-audit?orgId=${orgId}`);
      const data = await response.json();
      if (!active) return;
      if (!response.ok) setMessage(data.error ?? "Unable to load export audit");
      else {
        setMessage("");
        setEvents(data.events ?? []);
        setByAction(data.byAction ?? []);
      }
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [orgId]);

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">Team / Export audit</span>
          <h1>Who took a copy of the team&apos;s data</h1>
          <p className="app-muted">
            Every data export — requested, built, and downloaded — with who did it, the scope, and how large
            the archive was. Exports are encrypted and expire after 24 hours.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Security links">
          <a href={`/team/security?orgId=${orgId}`}>Access policy</a>
          <a href={`/team/audit?orgId=${orgId}`}>Audit log</a>
          <a href={`/team/posture?orgId=${orgId}`}>Posture</a>
          <a href={`/exports?orgId=${orgId}`}>Export center</a>
        </nav>
      </header>

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading export audit…</p>}

      {!loading && !!byAction.length && (
        <div className="tag-row" style={{ margin: "1rem 0" }}>
          {byAction.map((row) => (
            <span key={row.action}>
              {ACTION_LABELS[row.action] ?? row.action} · {row.count}
            </span>
          ))}
        </div>
      )}

      {!loading && (
        <section className="intel-panel">
          <span className="eyebrow">EXPORT ACTIVITY · LAST {events.length}</span>
          {!events.length && <p className="app-muted">No data exports recorded for this team.</p>}
          {events.map((event) => {
            const line = detail(event);
            return (
              <article
                className="admin-org"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}
                key={event.id}
              >
                <div>
                  <strong style={{ color: actionColor(event.action) }}>
                    {ACTION_LABELS[event.action] ?? event.action}
                  </strong>
                  <small>
                    {event.actorName ?? event.actorEmail ?? "Member"}
                    {line ? ` · ${line}` : ""}
                  </small>
                </div>
                <time>{new Date(event.createdAt).toLocaleString()}</time>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
