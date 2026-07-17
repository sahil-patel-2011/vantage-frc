"use client";

import { useEffect, useState } from "react";

type AdminEvent = {
  id: string;
  createdAt: string;
  action: string;
  payload: Record<string, unknown> | null;
  actorId: string;
  actorEmail: string | null;
  targetOrgId: string | null;
  targetOrgName: string | null;
  targetTeamNumber: number | null;
  targetUserId: string | null;
};

const shortId = (id: string | null) => (id ? `${id.slice(0, 8)}…` : "—");

function friendlyAction(action: string): string {
  return action.replaceAll(".", " · ").replaceAll("_", " ");
}

function payloadSummary(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const entries = Object.entries(payload).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return entries
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default function AdminAuditClient() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [byAction, setByAction] = useState<Array<{ action: string; count: string }>>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await fetch("/api/admin/audit");
      const data = await response.json();
      if (!active) return;
      if (!response.ok) setMessage(data.error ?? "Unable to load admin audit log");
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
  }, []);

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / PLATFORM AUDIT LOG</span>
          <h1>Control-plane actions across every team</h1>
          <p className="app-muted">
            Every platform-admin action — trials, credit gifts, pack changes, provisioning — recorded by the
            control plane. Read-only.
          </p>
        </div>
        <a href="/admin/commercial">Commercial control →</a>
      </header>

      {message && <p className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading audit log…</p>}

      {!loading && !!byAction.length && (
        <div className="tag-row" style={{ margin: "1rem 0" }}>
          {byAction.map((row) => (
            <span key={row.action}>
              {friendlyAction(row.action)} · {row.count}
            </span>
          ))}
        </div>
      )}

      {!loading && (
        <section className="intel-panel">
          <span className="eyebrow">RECENT ACTIONS · LAST {events.length}</span>
          {!events.length && <p className="app-muted">No platform-admin actions recorded yet.</p>}
          {events.map((event) => {
            const summary = payloadSummary(event.payload);
            return (
              <article
                className="admin-org"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}
                key={event.id}
              >
                <div>
                  <strong>{friendlyAction(event.action)}</strong>
                  <small>
                    by {event.actorEmail ?? shortId(event.actorId)}
                    {event.targetOrgName
                      ? ` · #${event.targetTeamNumber ?? "?"} ${event.targetOrgName}`
                      : event.targetOrgId
                        ? ` · org ${shortId(event.targetOrgId)}`
                        : ""}
                    {event.targetUserId ? ` · user ${shortId(event.targetUserId)}` : ""}
                    {summary ? ` · ${summary}` : ""}
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
