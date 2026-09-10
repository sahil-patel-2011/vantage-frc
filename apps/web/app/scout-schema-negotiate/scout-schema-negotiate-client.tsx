"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { submissionStatusLabel } from "../../lib/scout-schema-negotiate";
import type { ScoutSchemaNegotiateView } from "../../lib/scout-schema-negotiate/compute-scout-schema-negotiate";

type LiveView = Extract<ScoutSchemaNegotiateView, { status: "live" }>;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function ScoutSchemaNegotiateClient() {
  const [view, setView] = useState<ScoutSchemaNegotiateView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/scout-schema-negotiate${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutSchemaNegotiateView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFailureStatus(response.status);
          setFailureMessage("error" in data && data.error ? data.error : "");
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
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
        });
        const data = (await response.json()) as ScoutSchemaNegotiateView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Scout Schema Negotiate"}
          </>
        }
        title="Scout Schema Negotiate"
        description="Reconcile scouting submissions captured on an older tablet schema instead of silently dropping them."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
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
              message:
                failureMessage || "A network or server issue prevented loading. Try again.",
            },
          );
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <Button as="a" variant="primary" href={copy.primary.href}>
                  {copy.primary.label}
                </Button>
              ) : null}
              {copy.showRetry ? (
                <Button variant="secondary" type="button" onClick={() => load()}>
                  Retry
                </Button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your team." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <RegisterVersionForm busy={busy} mutate={mutate} />
          <VersionsPanel view={view} />
          <SubmissionsPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
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
