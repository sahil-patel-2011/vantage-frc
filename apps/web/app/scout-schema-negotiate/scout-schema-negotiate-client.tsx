"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { submissionStatusLabel } from "../../lib/scout-schema-negotiate";
import type { ScoutSchemaNegotiateView } from "../../lib/scout-schema-negotiate/compute-scout-schema-negotiate";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<ScoutSchemaNegotiateView, { status: "live" }>;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function isScoutSchemaNegotiateView(value: unknown): value is ScoutSchemaNegotiateView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function schemaNegotiateCacheOrg(data: ScoutSchemaNegotiateView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistSchemaNegotiateSnapshot(
  orgHint: string,
  data: ScoutSchemaNegotiateView,
): Promise<void> {
  const cacheOrg = schemaNegotiateCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("scout-schema-negotiate", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("scout-schema-negotiate", "_", data);
  } catch {
    // Live Schema sync already painted; IndexedDB is best-effort.
  }
}

function SchemaSyncRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related scouting tools">
      <Button as="a" variant="secondary" href={hubHref("/competition", "scouting", orgId)}>
        Scouting
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/competition", "scout-p2p-relay", orgId)}>
        Pit mesh
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/competition", "scouting-schema-ab", orgId)}>
        Schema A/B
      </Button>
    </nav>
  );
}

function SchemaSyncNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "register",
      label: "Register a form version",
      detail: "Name the fields on the form this team is using so older tablets can still submit.",
      href: "#schema-sync-register",
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Live match and pit entries are the rows this page keeps.",
      href: hubHref("/competition", "scouting", orgId),
      primary: false,
    },
    {
      id: "mesh",
      label: "Open Pit mesh",
      detail: "Tablets share entries in the pit when venue Wi-Fi drops.",
      href: hubHref("/competition", "scout-p2p-relay", orgId),
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

export default function ScoutSchemaNegotiateClient() {
  const [view, setView] = useState<ScoutSchemaNegotiateView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ScoutSchemaNegotiateView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<ScoutSchemaNegotiateView>(
        "scout-schema-negotiate",
        orgHint || "_",
      );
      if (!viewRef.current && cached?.data && isScoutSchemaNegotiateView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      const response = await fetch(
        `/api/scout-schema-negotiate${query.toString() ? `?${query.toString()}` : ""}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      if (!response.ok || !isScoutSchemaNegotiateView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Schema sync. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistSchemaNegotiateSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Schema sync. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/scout-schema-negotiate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isScoutSchemaNegotiateView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setFromCache(false);
        void persistSchemaNegotiateSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  const competitionHref = orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={competitionHref}>Competition</a>
          {" / Schema sync"}
        </>
      }
      title="Schema sync"
      description="Keep scout entries from an older tablet form instead of dropping them."
    >
      <SchemaSyncRelated orgId={orgId} />
    </PageHeader>
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: failureStatus,
            message: failureMessage,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: failureMessage || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Schema sync" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading…"}
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
          {header}
          <OfflineBanner feature="Schema sync" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Schema sync" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <SchemaSyncNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        <RegisterVersionForm busy={busy} mutate={mutate} />
        <VersionsPanel view={view} />
        <SubmissionsPanel view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Active schema", value: summary.activeVersionTag ?? "None set" },
    { label: "Known versions", value: String(summary.knownVersionCount) },
    { label: "Pending", value: String(summary.pending) },
    { label: "Reconciled", value: String(summary.reconciled) },
    { label: "Rejected", value: String(summary.rejected) },
    { label: "Field drift rate", value: pct(summary.fieldDriftRate) },
    { label: "Stale devices", value: String(summary.staleDeviceCount) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function VersionsPanel({ view }: { view: LiveView }) {
  if (view.versions.length === 0) {
    return (
      <EmptyState
        badge="No schema versions yet"
        badgeTone="setup"
        title="Register your first scouting schema version"
        description="Field keys let submissions from older tablets be compared against the current active form."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Registered schema versions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.versions.map((version) => (
          <li key={version.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{version.versionTag}</strong>
              {version.isActive ? <span className="app-badge good" style={{ marginLeft: 8 }}>ACTIVE</span> : null}
              <small className="app-muted" style={{ display: "block" }}>
                {version.fieldKeys.length} field(s): {version.fieldKeys.join(", ") || "none"}
              </small>
              {version.notes ? <small className="app-muted">{version.notes}</small> : null}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SubmissionsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.submissions.length === 0) {
    return (
      <EmptyState
        badge="No submissions staged"
        badgeTone="setup"
        title="No scouting submissions to reconcile"
        description="Submissions from tablets on an older schema version will appear here for review instead of being dropped."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Staged submissions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.submissions.slice(0, 50).map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>
                {item.deviceId} · schema {item.schemaVersion}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {submissionStatusLabel(item.status)}
                {item.matchNumber != null ? ` · match ${item.matchNumber}` : ""}
                {item.teamNumber != null ? ` · team ${item.teamNumber}` : ""}
              </small>
              {item.missingFields.length > 0 ? (
                <small className="app-muted">Missing: {item.missingFields.join(", ")}</small>
              ) : null}
              {item.extraFields.length > 0 ? (
                <small className="app-muted" style={{ display: "block" }}>
                  Extra: {item.extraFields.join(", ")}
                </small>
              ) : null}
            </div>
            {item.status === "pending" ? (
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "reconcile-submission", submissionId: item.id })}>
                  Reconcile
                </Button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "reject-submission", submissionId: item.id })}
                >
                  Reject
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RegisterVersionForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ versionTag: "", fieldKeys: "", notes: "" }), []);
  const [form, setForm] = useState(empty);
  const [makeActive, setMakeActive] = useState(true);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="schema-sync-register"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.versionTag.trim()) return;
        mutate({
          action: "register-version",
          versionTag: form.versionTag,
          fieldKeys: form.fieldKeys
            .split(",")
            .map((key) => key.trim())
            .filter(Boolean),
          makeActive,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Register schema version</h2>
      <FormGrid min={160}>
        <FormRow label="Version tag">
          <input value={form.versionTag} onChange={set("versionTag")} placeholder="v3" required />
        </FormRow>
        <FormRow label="Field keys (comma-separated)" wide>
          <input value={form.fieldKeys} onChange={set("fieldKeys")} placeholder="auto_score, teleop_score, climb" />
        </FormRow>
        <FormRow label="Notes (optional)" wide>
          <input value={form.notes} onChange={set("notes")} />
        </FormRow>
      </FormGrid>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={makeActive} onChange={(event) => setMakeActive(event.target.checked)} />
        Make this the active schema
      </label>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.versionTag.trim()}>
          Register version
        </Button>
      </div>
    </Panel>
  );
}
