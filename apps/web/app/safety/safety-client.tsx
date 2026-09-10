"use client";
import { useCallback, useEffect, useState } from "react";
import {
  CERT_TYPE_LABEL,
  CERT_TYPES,
  INCIDENT_SEVERITIES,
  type CertExpiry,
  type CertType,
  type IncidentSeverity,
  type IncidentStatus,
  type Treatment,
} from "../../lib/safety";
import { canDeleteSafetyIncident } from "../../lib/safety/authorization";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Incident = {
  id: string; title: string; severity: IncidentSeverity; occurredOn: string; location: string; description: string;
  injuredPerson: string; treatment: Treatment; correctiveAction: string; status: IncidentStatus; byName: string | null;
};
type Cert = { id: string; personName: string; certType: CertType; completedOn: string; expiresOn: string | null; notes: string; byName: string | null; expiry: CertExpiry };
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; incidents: Incident[]; certifications: Cert[]; summary: { openIncidents: number; seriousOpen: number; daysSinceLastIncident: number | null; expiringCerts: number; expiredCerts: number } };

const SEVERITY_LABEL: Record<IncidentSeverity, string> = { near_miss: "Near miss", minor: "Minor", moderate: "Moderate", serious: "Serious" };
const NEXT_STATUS: Record<IncidentStatus, IncidentStatus | null> = { open: "reviewed", reviewed: "closed", closed: null };
const EXPIRY_LABEL: Record<CertExpiry, string> = { valid: "valid", expiring: "expiring soon", expired: "EXPIRED", no_expiry: "no expiry" };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function SafetyClient({ orgId }: { orgId: string | null }) {
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [incidentForm, setIncidentForm] = useState({ title: "", severity: "near_miss", occurredOn: todayIso(), location: "", injuredPerson: "", treatment: "none", description: "", correctiveAction: "" });
  const [certForm, setCertForm] = useState({ personName: "", certType: "general_safety", completedOn: todayIso(), expiresOn: "", notes: "" });

  const load = useCallback(async () => {
    setLoadFailed(false);
    setFailureStatus(null);
    try {
      const response = await fetch(`/api/safety${orgId ? `?orgId=${orgId}` : ""}`);
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok) {
        setFailureStatus(response.status);
        setLoadFailed(true);
        setMessage(data.error ?? "Failed to load safety data");
        return;
      }
      setView(data);
    } catch {
      setLoadFailed(true);
    }
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/safety", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function logIncident(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "log_incident", ...incidentForm }, "Incident logged.");
    if (view?.status === "ready") setIncidentForm({ title: "", severity: "near_miss", occurredOn: todayIso(), location: "", injuredPerson: "", treatment: "none", description: "", correctiveAction: "" });
  }

  async function addCert(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "add_certification", ...certForm }, "Certification recorded.");
    if (view?.status === "ready") setCertForm({ personName: "", certType: "general_safety", completedOn: todayIso(), expiresOn: "", notes: "" });
  }

  if (!view) {
    if (!loadFailed) {
      return <main className="intel-app"><p className="telemetry-status">{message || "Loading safety…"}</p></main>;
    }
    const copy = loadFailureCopy(
      classifyLoadFailure({
        status: failureStatus,
        message,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      }),
      {
        nextPath:
          typeof window === "undefined"
            ? null
            : `${window.location.pathname}${window.location.search}`,
        message,
      },
    );
    return (
      <main className="intel-app">
        <p className="telemetry-status" role="alert">
          <strong>{copy.title}</strong> — {copy.description}
        </p>
        {copy.primary ? (
          <a className="app-button" href={copy.primary.href}>
            {copy.primary.label}
          </a>
        ) : null}
        {copy.showRetry ? (
          <button type="button" className="app-button secondary" onClick={() => void load()}>
            Retry
          </button>
        ) : null}
      </main>
    );
  }
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / SAFETY</span><h1>Safety log</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const canDeleteIncidents = canDeleteSafetyIncident(view.context.role);

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / SAFETY</span><h1>Safety log &amp; tool certifications</h1></div>
        <nav className="intel-actions"><a href={`/inventory${orgId ? `?orgId=${orgId}` : ""}`}>Inventory</a><a href={`/pit${orgId ? `?orgId=${orgId}` : ""}`}>Pit</a><a href="/workspace">Your team →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="metric-grid">
        <article><span>Days since last incident</span><strong>{view.summary.daysSinceLastIncident ?? "—"}</strong></article>
        <article><span>Open incidents</span><strong>{view.summary.openIncidents}</strong></article>
        <article><span>Serious &amp; open</span><strong>{view.summary.seriousOpen}</strong></article>
        <article><span>Certs expiring / expired</span><strong>{view.summary.expiringCerts} / {view.summary.expiredCerts}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={logIncident}>
          <span className="eyebrow">REPORT AN INCIDENT / NEAR MISS</span>
          <label>What happened<input required value={incidentForm.title} onChange={(e) => setIncidentForm({ ...incidentForm, title: e.target.value })} placeholder="Finger pinched in gearbox" /></label>
          <div className="budget-fields">
            <label>Severity<select value={incidentForm.severity} onChange={(e) => setIncidentForm({ ...incidentForm, severity: e.target.value })}>{INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}</select></label>
            <label>Date<input type="date" value={incidentForm.occurredOn} onChange={(e) => setIncidentForm({ ...incidentForm, occurredOn: e.target.value })} /></label>
          </div>
          <div className="budget-fields">
            <label>Location<input value={incidentForm.location} onChange={(e) => setIncidentForm({ ...incidentForm, location: e.target.value })} placeholder="Machine shop" /></label>
            <label>Treatment<select value={incidentForm.treatment} onChange={(e) => setIncidentForm({ ...incidentForm, treatment: e.target.value })}><option value="none">None</option><option value="first_aid">First aid</option><option value="professional">Professional</option></select></label>
          </div>
          <label>Person involved<input value={incidentForm.injuredPerson} onChange={(e) => setIncidentForm({ ...incidentForm, injuredPerson: e.target.value })} /></label>
          <label>Description<input value={incidentForm.description} onChange={(e) => setIncidentForm({ ...incidentForm, description: e.target.value })} /></label>
          <label>Corrective action<input value={incidentForm.correctiveAction} onChange={(e) => setIncidentForm({ ...incidentForm, correctiveAction: e.target.value })} placeholder="Added guard, retrained team" /></label>
          <button className="primary-action">Log incident</button>
        </form>

        <form className="intel-panel" onSubmit={addCert}>
          <span className="eyebrow">RECORD A TOOL CERTIFICATION</span>
          <label>Person<input required value={certForm.personName} onChange={(e) => setCertForm({ ...certForm, personName: e.target.value })} /></label>
          <label>Tool / certification<select value={certForm.certType} onChange={(e) => setCertForm({ ...certForm, certType: e.target.value })}>{CERT_TYPES.map((t) => <option key={t} value={t}>{CERT_TYPE_LABEL[t]}</option>)}</select></label>
          <div className="budget-fields">
            <label>Completed<input type="date" value={certForm.completedOn} onChange={(e) => setCertForm({ ...certForm, completedOn: e.target.value })} /></label>
            <label>Expires (optional)<input type="date" value={certForm.expiresOn} onChange={(e) => setCertForm({ ...certForm, expiresOn: e.target.value })} /></label>
          </div>
          <label>Notes<input value={certForm.notes} onChange={(e) => setCertForm({ ...certForm, notes: e.target.value })} /></label>
          <button className="primary-action">Record certification</button>
        </form>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">INCIDENT LOG</span>
        {view.incidents.length === 0 && <p>No incidents logged — keep it that way.</p>}
        {view.incidents.map((i) => (
          <article key={i.id}>
            <div>
              <strong>{SEVERITY_LABEL[i.severity]} · {i.title}</strong>
              <small>{new Date(i.occurredOn).toLocaleDateString()}{i.location ? ` · ${i.location}` : ""}{i.injuredPerson ? ` · ${i.injuredPerson}` : ""} · treatment: {i.treatment} · {i.status}</small>
              {i.correctiveAction && <small>Action: {i.correctiveAction}</small>}
            </div>
            <div>
              {NEXT_STATUS[i.status] && <button onClick={() => void post({ action: "set_incident_status", id: i.id, status: NEXT_STATUS[i.status] }, "Incident updated.")}>Mark {NEXT_STATUS[i.status]}</button>}
              {canDeleteIncidents ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm("Delete this incident? The log entry cannot be recovered.")) return;
                    void post({ action: "delete_incident", id: i.id }, "Incident deleted.");
                  }}
                >
                  Delete
                </button>
              ) : null}
              {(i.severity === "serious" || i.severity === "moderate") && i.status !== "closed" && <b>REVIEW</b>}
            </div>
          </article>
        ))}
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">TOOL CERTIFICATIONS</span>
        {view.certifications.length === 0 && <p>No certifications recorded yet.</p>}
        {view.certifications.map((c) => (
          <article key={c.id}>
            <div>
              <strong>{c.personName} · {CERT_TYPE_LABEL[c.certType]}</strong>
              <small>completed {new Date(c.completedOn).toLocaleDateString()}{c.expiresOn ? ` · expires ${new Date(c.expiresOn).toLocaleDateString()}` : ""} · {EXPIRY_LABEL[c.expiry]}{c.byName ? ` · by ${c.byName}` : ""}</small>
            </div>
            {(c.expiry === "expired" || c.expiry === "expiring") && <b>{c.expiry === "expired" ? "EXPIRED" : "RENEW"}</b>}
          </article>
        ))}
      </section>
    </main>
  );
}
