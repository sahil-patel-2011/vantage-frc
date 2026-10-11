"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, PageHeader } from "../../components/ui";
import { CERT_TYPE_LABEL, CERT_TYPES, type CertExpiry, type CertType } from "../../lib/safety";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS, persistOrgIdInUrl } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./safety.css";
import { mentionsWaitlist, withWaitlistLink } from "../../components/waitlist-link";

type Cert = { id: string; personName: string; certType: CertType; completedOn: string; expiresOn: string | null; notes: string; byName: string | null; expiry: CertExpiry };
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; certifications: Cert[]; summary: { expiringCerts: number; expiredCerts: number } };

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
    // Live certifications already painted; IndexedDB is best-effort.
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function SafetyRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related safety tools">
      <a href={hubHref("/team", "safety-training", orgId)}>Safety training</a>
      <a href={withOrgHref("/tool-checkout", orgId)}>Tool checkout</a>
    </nav>
  );
}

function SafetyHeader({ orgId, description }: { orgId?: string | null; description?: ReactNode }) {
  const teamHref = orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team";
  return (
    <PageHeader
      breadcrumbs={
        <>
          <a href={teamHref}>Team</a>
          {" / Tool certifications"}
        </>
      }
      title="Tool certifications"
      description={description ?? "Who is cleared on which shop tools, and when each clearance runs out."}
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
            : "Failed to load tool certifications",
        );
        return;
      }
      if (!response.ok || !isSafetyView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh tool certifications. Showing the last copy on this device.");
          setLoadFailed(false);
        } else {
          setFailureStatus(response.status);
          setLoadFailed(true);
          setMessage(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Failed to load tool certifications",
          );
        }
        return;
      }
      if (data.status === "ready" && data.context.orgId) persistOrgIdInUrl(data.context.orgId);
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistSafetySnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh tool certifications. Showing the last copy on this device.");
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
        <OfflineBanner feature="Tool certifications" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading tool certifications…"}
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
    case "setup_required": {
      const offerWaitlist = !orgId && mentionsWaitlist(view.message);
      return (
        <main className="module-page safety-page">
          <SafetyHeader
            orgId={orgId}
            description={offerWaitlist ? withWaitlistLink(view.message) : undefined}
          />
          <OfflineBanner feature="Tool certifications" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState
            badge="Needs setup"
            badgeTone="setup"
            soft
            title="Choose your team"
            description={offerWaitlist ? withWaitlistLink(view.message) : view.message}
            className={offerWaitlist ? "safety-setup" : undefined}
          >
            <div className={offerWaitlist ? "safety-setup-actions" : undefined}>
              <Button as="a" variant="primary" href="/workspace">Choose your team</Button>
              {offerWaitlist ? (
                <a className="safety-setup-waitlist" href="/#waitlist">
                  Join the waitlist
                </a>
              ) : null}
            </div>
          </EmptyState>
        </main>
      );
    }
    case "ready":
      break;
    default: {
      const data: never = view;
      return data satisfies never;
    }
  }

  const certCount = view.certifications.length;

  return (
    <main className="module-page safety-page">
      <SafetyHeader orgId={view.context.orgId} />
      <OfflineBanner feature="Tool certifications" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? <p className="telemetry-status" role="status">{message}</p> : null}

      <section className="metric-grid safety-cert-metrics">
        <article><span>Certifications</span><strong>{certCount}</strong></article>
        <article><span>Expiring in 30 days</span><strong>{view.summary.expiringCerts}</strong></article>
        <article><span>Expired</span><strong>{view.summary.expiredCerts}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addCert}>
          <h2 className="safety-card-title">Record a certification</h2>
          <label>Person<input required value={certForm.personName} onChange={(e) => setCertForm({ ...certForm, personName: e.target.value })} /></label>
          <label>Tool / certification<select value={certForm.certType} onChange={(e) => setCertForm({ ...certForm, certType: e.target.value })}>{CERT_TYPES.map((t) => <option key={t} value={t}>{CERT_TYPE_LABEL[t]}</option>)}</select></label>
          <div className="budget-fields">
            <label>Completed<input type="date" value={certForm.completedOn} onChange={(e) => setCertForm({ ...certForm, completedOn: e.target.value })} /></label>
            <label>Expires (optional)<input type="date" value={certForm.expiresOn} onChange={(e) => setCertForm({ ...certForm, expiresOn: e.target.value })} /></label>
          </div>
          <label>Notes<input value={certForm.notes} onChange={(e) => setCertForm({ ...certForm, notes: e.target.value })} /></label>
          <Button variant="primary" type="submit">Record certification</Button>
        </form>

        <section className="intel-panel invite-list">
          <h2 className="safety-card-title">Who is cleared</h2>
          {certCount === 0 && <p>No certifications recorded yet. Record each person once they are trained on a tool.</p>}
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
      </section>
    </main>
  );
}
