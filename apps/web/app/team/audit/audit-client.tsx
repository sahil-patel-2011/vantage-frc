"use client";

import { useEffect, useState } from "react";

type AuditEvent = {
  category: "membership" | "auth";
  id: string;
  createdAt: string;
  action: string;
  metadata: Record<string, unknown> | null;
  actorName: string | null;
  actorEmail: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  "member.capabilities.updated": "Updated member capabilities",
  "member.promoted_admin": "Promoted member to admin",
  "member.role.updated": "Changed member role",
  "invite.created": "Sent invitation",
  "invite.resent": "Resent invitation",
  "invite.revoked": "Revoked invitation",
  "invite.accepted": "Invitation accepted",
  "organization.created": "Created organization",
  "org.auth_policy.updated": "Updated authentication policy",
  "mfa.begin": "Started 2FA enrollment",
  "mfa.confirm": "Confirmed 2FA enrollment",
  "mfa.regenerate": "Regenerated recovery codes",
  "mfa.step-up": "Completed 2FA step-up",
  "mfa.revoked": "Revoked 2FA",
  "mfa.device_revoked": "Revoked remembered device",
};

function describe(event: AuditEvent): string {
  const meta = event.metadata ?? {};
  if (event.action === "member.role.updated" || event.action === "member.promoted_admin") {
    if (meta.before && meta.after) return `${meta.before} → ${meta.after}`;
  }
  if (event.action === "member.capabilities.updated" && Array.isArray(meta.after)) {
    return (meta.after as string[]).length ? (meta.after as string[]).join(", ") : "no capabilities";
  }
  if (typeof meta.role === "string") return `role: ${meta.role}`;
  return "";
}

export default function AuditLogClient({ orgId }: { orgId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await fetch(`/api/organizations/audit?orgId=${orgId}`);
      const data = await response.json();
      if (!active) return;
      if (!response.ok) setMessage(data.error ?? "Unable to load audit log");
      else {
        setMessage("");
        setEvents(data.events ?? []);
      }
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [orgId]);

  return (
    <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
      <span className="eyebrow">SECURITY AUDIT LOG</span>
      <h2>Recent membership &amp; access changes</h2>
      <p className="app-muted">
        Every capability, role, invitation, and authentication-policy change is recorded here. Showing the
        {events.length ? ` most recent ${events.length}` : " latest"} events.
      </p>
      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading audit log…</p>}
      {!loading && !events.length && !message && (
        <p className="app-muted">No audited changes yet.</p>
      )}
      {!loading &&
        events.map((event) => {
          const detail = describe(event);
          return (
            <article
              className="admin-org"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}
              key={`${event.category}-${event.id}`}
            >
              <div>
                <strong>{ACTION_LABELS[event.action] ?? event.action}</strong>
                <small>
                  {event.actorName ?? event.actorEmail ?? "System"} · {event.category}
                  {detail ? ` · ${detail}` : ""}
                </small>
              </div>
              <time>{new Date(event.createdAt).toLocaleString()}</time>
            </article>
          );
        })}
    </section>
  );
}
