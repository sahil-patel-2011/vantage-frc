"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, PageHeader } from "../../components/ui";
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
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
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

function isSafetyView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function safetyCacheOrg(data: View, orgHint: string): string {
  if (data.status === "ready" && data.context.orgId.trim()) return data.context.orgId;
  return orgHint;
}

async function persistSafetySnapshot(orgHint: string, data: View): Promise<void> {
  const cacheOrg = safetyCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("safety", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("safety", "_", data);
  } catch {
    // Live safety log already painted; IndexedDB is best-effort.
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function SafetyRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related safety tools">
      <Button as="a" variant="secondary" href={withOrgHref("/incidents", orgId)}>
        Safety incidents
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "safety-training", orgId)}>
        Safety training
      </Button>
    </nav>
  );
}

function SafetyHeader({ orgId }: { orgId?: string | null }) {
  const teamHref = orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team";
  return (
    <PageHeader
      breadcrumbs={
        <>
          <a href={teamHref}>Team</a>
          {" / Safety log"}
        </>
      }
      title="Safety log"
      description="Incidents, near-misses, and who is cleared on which tools."
    >
      <SafetyRelated orgId={orgId} />
    </PageHeader>
  );
}

export default function SafetyClient({ orgId }: { orgId: string | null }) {
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [incidentForm, setIncidentForm] = useState({ title: "", severity: "near_miss", occurredOn: todayIso(), location: "", injuredPerson: "", treatment: "none", description: "", correctiveAction: "" });
  const [certForm, setCertForm] = useState({ personName: "", certType: "general_safety", completedOn: todayIso(), expiresOn: "", notes: "" });
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("safety", orgHint || "_");
      if (!viewRef.current && cached?.data && isSafetyView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setLoadFailed(false);
    setFailureStatus(null);
    try {
      const response = await fetch(`/api/safety${orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFailureStatus(response.status);
        setLoadFailed(true);
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load safety data",
        );
        return;
      }
      if (!response.ok || !isSafetyView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Safety. Showing the last copy on this device.");
          setLoadFailed(false);
        } else {
          setFailureStatus(response.status);
          setLoadFailed(true);
          setMessage(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Failed to load safety data",
          );
        }
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistSafetySnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Safety. Showing the last copy on this device.");
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    }
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    try {
      const response = await fetch("/api/safety", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: view.context.orgId, ...body }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = await response.json();
      setMessage(response.ok ? okMessage : data.error);
      if (response.ok) await load();
    } catch {
      setMessage("Network error — changes were not saved.");
    }
  }

  async function logIncident(event: FormEvent) {
    event.preventDefault();
    await post({ action: "log_incident", ...incidentForm }, "Incident logged.");
    if (view?.status === "ready") setIncidentForm({ title: "", severity: "near_miss", occurredOn: todayIso(), location: "", injuredPerson: "", treatment: "none", description: "", correctiveAction: "" });
  }

  async function addCert(event: FormEvent) {
    event.preventDefault();
    await post({ action: "add_certification", ...certForm }, "Certification recorded.");
    if (view?.status === "ready") setCertForm({ personName: "", certType: "general_safety", completedOn: todayIso(), expiresOn: "", notes: "" });
  }

  if (!view) {
    const failure = loadFailed
      ? loadFailureCopy(
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
        )
      : null;
    return (
      <main className="module-page">
        <SafetyHeader orgId={orgId} />
        <OfflineBanner feature="Safety" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Opening Safety log"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!loadFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>{failure.primary.label}</Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>Retry</Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          <SafetyHeader orgId={orgId} />
          <OfflineBanner feature="Safety" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState badge="Needs setup" badgeTone="setup" soft title="Choose your team" description={view.message}>
            <Button as="a" variant="primary" href="/workspace">Choose your team</Button>
          </EmptyState>
        </main>
      );
    case "ready":
      break;
    default: {
      const data: never = view;
      return data satisfies never;
    }
  }

  const canDeleteIncidents = canDeleteSafetyIncident(view.context.role);

  return (
    <main className="module-page">
      <SafetyHeader orgId={view.context.orgId} />
      <OfflineBanner feature="Safety" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? <p className="telemetry-status" role="status">{message}</p> : null}

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
          <Button variant="primary" type="submit">Log incident</Button>
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
          <Button variant="primary" type="submit">Record certification</Button>
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
              {NEXT_STATUS[i.status] ? (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => void post({ action: "set_incident_status", id: i.id, status: NEXT_STATUS[i.status] }, "Incident updated.")}
                >
                  Mark {NEXT_STATUS[i.status]}
                </Button>
              ) : null}
              {canDeleteIncidents ? (
                <Button
                  variant="danger"
                  type="button"
                  onClick={() => {
                    if (!window.confirm("Delete this incident? The log entry cannot be recovered.")) return;
                    void post({ action: "delete_incident", id: i.id }, "Incident deleted.");
                  }}
                >
                  Delete
                </Button>
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
