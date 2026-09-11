"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import {
  CERT_TYPE_LABEL,
  CERT_TYPES,
  INCIDENT_SEVERITIES,
  TREATMENTS,
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
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Incident = {
  id: string;
  title: string;
  severity: IncidentSeverity;
  occurredOn: string;
  location: string;
  description: string;
  injuredPerson: string;
  treatment: Treatment;
  correctiveAction: string;
  status: IncidentStatus;
  byName: string | null;
};
type Cert = {
  id: string;
  personName: string;
  certType: CertType;
  completedOn: string;
  expiresOn: string | null;
  notes: string;
  byName: string | null;
  expiry: CertExpiry;
};
type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string };
      incidents: Incident[];
      certifications: Cert[];
      summary: {
        openIncidents: number;
        seriousOpen: number;
        daysSinceLastIncident: number | null;
        expiringCerts: number;
        expiredCerts: number;
      };
    };

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  near_miss: "Near miss",
  minor: "Minor",
  moderate: "Moderate",
  serious: "Serious",
};
const TREATMENT_LABEL: Record<Treatment, string> = {
  none: "None",
  first_aid: "First aid",
  professional: "Professional",
};
const EXPIRY_LABEL: Record<CertExpiry, string> = {
  valid: "valid",
  expiring: "expiring soon",
  expired: "EXPIRED",
  no_expiry: "no expiry",
};

function nextIncidentStatus(status: IncidentStatus): IncidentStatus | null {
  switch (status) {
    case "open":
      return "reviewed";
    case "reviewed":
      return "closed";
    case "closed":
      return null;
    default: {
      status satisfies never;
      return null;
    }
  }
}

function isSafetyView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function safetyCacheOrg(data: View, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return orgHint;
    case "ready":
      return data.context.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
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
      <Button as="a" variant="secondary" href={hubHref("/team", "safety-training", orgId)}>
        Safety training
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "training", orgId)}>
        Training matrix
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "tool-checkout", orgId)}>
        Tool checkout
      </Button>
    </nav>
  );
}

function SafetyNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "log",
      label: "Log an incident",
      detail: "Near-misses count. The log is what judges and mentors read.",
      href: "#safety-incident-form",
      primary: true,
    },
    {
      id: "training",
      label: "Open Safety training",
      detail: "Shop modules sit next to this incident log.",
      href: hubHref("/team", "safety-training", orgId),
      primary: false,
    },
    {
      id: "certs",
      label: "Record a certification",
      detail: "Who is cleared on mill, bandsaw, and electrical.",
      href: "#safety-cert-form",
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

const EMPTY_INCIDENT = {
  title: "",
  severity: "near_miss" as IncidentSeverity,
  occurredOn: todayIso(),
  location: "",
  injuredPerson: "",
  treatment: "none" as Treatment,
  description: "",
  correctiveAction: "",
};

const EMPTY_CERT = {
  personName: "",
  certType: "general_safety" as CertType,
  completedOn: todayIso(),
  expiresOn: "",
  notes: "",
};

export default function SafetyClient({ orgId }: { orgId: string | null }) {
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [incidentForm, setIncidentForm] = useState(EMPTY_INCIDENT);
  const [certForm, setCertForm] = useState(EMPTY_CERT);
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
    setFetchFailed(false);
    setLoadError("");
    setErrorStatus(null);
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
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isSafetyView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Safety. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load safety data",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistSafetySnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Safety. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    try {
      const response = await fetch("/api/safety", {
        method: "POST",
        headers: { "content-type": "application/json" },
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
    if (view?.status === "ready") setIncidentForm({ ...EMPTY_INCIDENT, occurredOn: todayIso() });
  }

  async function addCert(event: FormEvent) {
    event.preventDefault();
    await post({ action: "add_certification", ...certForm }, "Certification recorded.");
    if (view?.status === "ready") setCertForm({ ...EMPTY_CERT, completedOn: todayIso() });
  }

  const teamHref = orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team";

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
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
        <OfflineBanner feature="Safety" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading safety…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
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
          <OfflineBanner feature="Safety" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState badge="Setup required" badgeTone="setup" title="Choose your team" description={view.message}>
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          </EmptyState>
        </main>
      );
    case "ready":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  const canDeleteIncidents = canDeleteSafetyIncident(view.context.role);

  return (
    <main className="module-page">
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
        <SafetyRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Safety" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="app-muted" role="status">
          {message}
        </p>
      ) : null}

      <SafetyNextActions orgId={view.context.orgId} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatTile label="Days since last incident" value={view.summary.daysSinceLastIncident ?? "—"} />
        <StatTile label="Open incidents" value={view.summary.openIncidents} />
        <StatTile label="Serious and open" value={view.summary.seriousOpen} />
        <StatTile
          label="Certs expiring / expired"
          value={`${view.summary.expiringCerts} / ${view.summary.expiredCerts}`}
        />
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <Panel as="form" id="safety-incident-form" onSubmit={logIncident}>
          <h2>Report an incident / near miss</h2>
          <FormRow label="What happened">
            <input
              required
              value={incidentForm.title}
              onChange={(e) => setIncidentForm({ ...incidentForm, title: e.target.value })}
              placeholder="Finger pinched in gearbox"
            />
          </FormRow>
          <FormGrid min={140}>
            <FormRow label="Severity">
              <select
                value={incidentForm.severity}
                onChange={(e) =>
                  setIncidentForm({ ...incidentForm, severity: e.target.value as IncidentSeverity })
                }
              >
                {INCIDENT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABEL[s]}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Date">
              <input
                type="date"
                value={incidentForm.occurredOn}
                onChange={(e) => setIncidentForm({ ...incidentForm, occurredOn: e.target.value })}
              />
            </FormRow>
            <FormRow label="Location">
              <input
                value={incidentForm.location}
                onChange={(e) => setIncidentForm({ ...incidentForm, location: e.target.value })}
                placeholder="Machine shop"
              />
            </FormRow>
            <FormRow label="Treatment">
              <select
                value={incidentForm.treatment}
                onChange={(e) => setIncidentForm({ ...incidentForm, treatment: e.target.value as Treatment })}
              >
                {TREATMENTS.map((t) => (
                  <option key={t} value={t}>
                    {TREATMENT_LABEL[t]}
                  </option>
                ))}
              </select>
            </FormRow>
          </FormGrid>
          <FormRow label="Person involved">
            <input
              value={incidentForm.injuredPerson}
              onChange={(e) => setIncidentForm({ ...incidentForm, injuredPerson: e.target.value })}
            />
          </FormRow>
          <FormRow label="Description">
            <input
              value={incidentForm.description}
              onChange={(e) => setIncidentForm({ ...incidentForm, description: e.target.value })}
            />
          </FormRow>
          <FormRow label="Corrective action">
            <input
              value={incidentForm.correctiveAction}
              onChange={(e) => setIncidentForm({ ...incidentForm, correctiveAction: e.target.value })}
              placeholder="Added guard, retrained team"
            />
          </FormRow>
          <Button variant="primary" type="submit">
            Log incident
          </Button>
        </Panel>

        <Panel as="form" id="safety-cert-form" onSubmit={addCert}>
          <h2>Record a tool certification</h2>
          <FormRow label="Person">
            <input
              required
              value={certForm.personName}
              onChange={(e) => setCertForm({ ...certForm, personName: e.target.value })}
            />
          </FormRow>
          <FormRow label="Tool / certification">
            <select
              value={certForm.certType}
              onChange={(e) => setCertForm({ ...certForm, certType: e.target.value as CertType })}
            >
              {CERT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CERT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </FormRow>
          <FormGrid min={140}>
            <FormRow label="Completed">
              <input
                type="date"
                value={certForm.completedOn}
                onChange={(e) => setCertForm({ ...certForm, completedOn: e.target.value })}
              />
            </FormRow>
            <FormRow label="Expires (optional)">
              <input
                type="date"
                value={certForm.expiresOn}
                onChange={(e) => setCertForm({ ...certForm, expiresOn: e.target.value })}
              />
            </FormRow>
          </FormGrid>
          <FormRow label="Notes">
            <input
              value={certForm.notes}
              onChange={(e) => setCertForm({ ...certForm, notes: e.target.value })}
            />
          </FormRow>
          <Button variant="primary" type="submit">
            Record certification
          </Button>
        </Panel>
      </div>

      <Panel>
        <h2>Incident log</h2>
        {view.incidents.length === 0 ? <p className="app-muted">No incidents logged — keep it that way.</p> : null}
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {view.incidents.map((i) => {
            const next = nextIncidentStatus(i.status);
            return (
              <li
                key={i.id}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}
              >
                <div>
                  <strong>
                    {SEVERITY_LABEL[i.severity]} · {i.title}
                  </strong>
                  <small className="app-muted" style={{ display: "block" }}>
                    {new Date(i.occurredOn).toLocaleDateString()}
                    {i.location ? ` · ${i.location}` : ""}
                    {i.injuredPerson ? ` · ${i.injuredPerson}` : ""} · treatment: {TREATMENT_LABEL[i.treatment]} ·{" "}
                    {i.status}
                  </small>
                  {i.correctiveAction ? (
                    <small className="app-muted" style={{ display: "block" }}>
                      Action: {i.correctiveAction}
                    </small>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {next ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void post({ action: "set_incident_status", id: i.id, status: next }, "Incident updated.")}
                    >
                      Mark {next}
                    </Button>
                  ) : null}
                  {canDeleteIncidents ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (!window.confirm("Delete this incident? The log entry cannot be recovered.")) return;
                        void post({ action: "delete_incident", id: i.id }, "Incident deleted.");
                      }}
                    >
                      Delete
                    </Button>
                  ) : null}
                  {(i.severity === "serious" || i.severity === "moderate") && i.status !== "closed" ? (
                    <strong>Review</strong>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel>
        <h2>Tool certifications</h2>
        {view.certifications.length === 0 ? <p className="app-muted">No certifications recorded yet.</p> : null}
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {view.certifications.map((c) => (
            <li
              key={c.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}
            >
              <div>
                <strong>
                  {c.personName} · {CERT_TYPE_LABEL[c.certType]}
                </strong>
                <small className="app-muted" style={{ display: "block" }}>
                  completed {new Date(c.completedOn).toLocaleDateString()}
                  {c.expiresOn ? ` · expires ${new Date(c.expiresOn).toLocaleDateString()}` : ""} ·{" "}
                  {EXPIRY_LABEL[c.expiry]}
                  {c.byName ? ` · by ${c.byName}` : ""}
                </small>
              </div>
              {c.expiry === "expired" || c.expiry === "expiring" ? (
                <strong>{c.expiry === "expired" ? "Expired" : "Renew"}</strong>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  );
}
