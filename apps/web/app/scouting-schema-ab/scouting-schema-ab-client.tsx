"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import type { SchemaAbView } from "../../lib/scouting-schema-ab/compute-scouting-schema-ab";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<SchemaAbView, { status: "live" }>;

function isSchemaAbView(value: unknown): value is SchemaAbView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function schemaAbCacheOrg(data: SchemaAbView, orgHint: string): string {
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

async function persistSchemaAbSnapshot(orgHint: string, data: SchemaAbView): Promise<void> {
  const cacheOrg = schemaAbCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("scouting-schema-ab", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("scouting-schema-ab", "_", data);
  } catch {
    // Live Schema A/B already painted; IndexedDB is best-effort.
  }
}

function SchemaAbRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related scouting tools">
      <Button as="a" variant="secondary" href={hubHref("/competition", "scouting", orgId)}>
        Scouting
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/competition", "scout-schema-negotiate", orgId)}>
        Schema sync
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/competition", "forms", orgId)}>
        Forms
      </Button>
    </nav>
  );
}

function SchemaAbNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "add",
      label: "Add a form to trial",
      detail: "Register the two (or more) scouting forms you want to compare this season.",
      href: "#schema-ab-add",
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Live match and pit entries are what these forms collect.",
      href: hubHref("/competition", "scouting", orgId),
      primary: false,
    },
    {
      id: "sync",
      label: "Open Schema sync",
      detail: "Older tablet forms are kept here instead of being dropped.",
      href: hubHref("/competition", "scout-schema-negotiate", orgId),
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

export default function ScoutingSchemaAbClient() {
  const [view, setView] = useState<SchemaAbView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<SchemaAbView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (overrideA?: string, overrideB?: string) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<SchemaAbView>("scouting-schema-ab", orgHint || "_");
      if (!viewRef.current && cached?.data && isSchemaAbView(cached.data)) {
        setView(cached.data);
        if (cached.data.status === "live" && cached.data.comparison) {
          setCompareA(cached.data.comparison.a.candidateId);
          setCompareB(cached.data.comparison.b.candidateId);
        }
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
      if (overrideA) query.set("compareA", overrideA);
      if (overrideB) query.set("compareB", overrideB);
      const response = await fetch(
        `/api/scouting-schema-ab${query.toString() ? `?${query.toString()}` : ""}`,
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
      if (!response.ok || !isSchemaAbView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Schema A/B. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      setView(data);
      if (data.status === "live" && data.comparison) {
        setCompareA(data.comparison.a.candidateId);
        setCompareB(data.comparison.b.candidateId);
      }
      setFromCache(false);
      setCachedAt(null);
      await persistSchemaAbSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Schema A/B. Showing the last copy on this device.");
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
        const response = await fetch("/api/scouting-schema-ab", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId,
            compareA: compareA || undefined,
            compareB: compareB || undefined,
            ...payload,
          }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isSchemaAbView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setFromCache(false);
        void persistSchemaAbSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy, compareA, compareB],
  );

  const competitionHref = orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={competitionHref}>Competition</a>
          {" / Schema A/B"}
        </>
      }
      title="Schema A/B"
      description="Trial two scouting forms and compare how complete and fast they are before you pick one for the season."
    >
      <SchemaAbRelated orgId={orgId} />
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
        <OfflineBanner feature="Schema A/B" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Opening Schema A/B"}
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
          <OfflineBanner feature="Schema A/B" fromCache={fromCache} cachedAt={cachedAt} />
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
      <OfflineBanner feature="Schema A/B" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <SchemaAbNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <NewCandidateForm busy={busy} mutate={mutate} />
        {view.candidates.length === 0 ? (
          <EmptyState
            badge="No candidates yet"
            badgeTone="setup"
            title="Add your first schema candidate"
            description="Register the two (or more) form schemas you want to trial, then log samples as scouts use them."
          />
        ) : (
          <>
            <RankingPanel view={view} busy={busy} mutate={mutate} />
            <ComparisonPicker
              view={view}
              compareA={compareA}
              compareB={compareB}
              setCompareA={setCompareA}
              setCompareB={setCompareB}
              onCompare={() => void load(compareA, compareB)}
            />
            {view.comparison ? <ComparisonPanel comparison={view.comparison} /> : null}
            <LogSampleForm view={view} busy={busy} mutate={mutate} />
            <SamplesPanel view={view} busy={busy} mutate={mutate} />
          </>
        )}
      </div>
    </main>
  );
}

function RankingPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Candidates ranked by quality score</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.stats.map((stat) => (
          <li
            key={stat.candidateId}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{stat.label}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {stat.fieldCount} field(s) · {stat.sampleCount} sample(s)
              </small>
              {stat.sampleCount > 0 ? (
                <small className="app-muted">
                  {pct(stat.avgCompletionRate)} completion · {pct(stat.errorRate)} error rate ·{" "}
                  {stat.avgFillSeconds != null ? `${stat.avgFillSeconds}s avg fill` : "no timing yet"} ·{" "}
                  quality {pct(stat.qualityScore)}
                </small>
              ) : (
                <small className="app-muted">No samples logged yet.</small>
              )}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete candidate "${stat.label}" and its samples?`)) {
                  mutate({ action: "delete-candidate", candidateId: stat.candidateId });
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ComparisonPicker({
  view,
  compareA,
  compareB,
  setCompareA,
  setCompareB,
  onCompare,
}: {
  view: LiveView;
  compareA: string;
  compareB: string;
  setCompareA: (value: string) => void;
  setCompareB: (value: string) => void;
  onCompare: () => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Head-to-head</h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <FormRow label="Schema A">
          <select value={compareA} onChange={(event) => setCompareA(event.target.value)}>
            <option value="">Choose…</option>
            {view.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Schema B">
          <select value={compareB} onChange={(event) => setCompareB(event.target.value)}>
            <option value="">Choose…</option>
            {view.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </FormRow>
        <Button variant="secondary" type="button" disabled={!compareA || !compareB || compareA === compareB} onClick={onCompare}>
          Compare
        </Button>
      </div>
    </Panel>
  );
}

function ComparisonPanel({ comparison }: { comparison: NonNullable<LiveView["comparison"]> }) {
  const { a, b, winnerId, reasons } = comparison;
  return (
    <Panel aria-label="Schema comparison result">
      <h2 style={{ marginTop: 0 }}>Comparison result</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        {[a, b].map((stat) => (
          <div key={stat.candidateId} className={winnerId === stat.candidateId ? "app-card soft-panel" : undefined}>
            <span className={`app-badge ${winnerId === stat.candidateId ? "good" : "demo"}`}>
              {winnerId === stat.candidateId ? "LEADING" : stat.label}
            </span>
            <h3 style={{ margin: "6px 0" }}>{stat.label}</h3>
            <p className="app-muted" style={{ margin: 0 }}>
              {stat.sampleCount} sample(s) · quality {pct(stat.qualityScore)}
            </p>
            <p className="app-muted" style={{ margin: 0 }}>
              {pct(stat.avgCompletionRate)} completion · {pct(stat.errorRate)} error
              {stat.avgFillSeconds != null ? ` · ${stat.avgFillSeconds}s avg fill` : ""}
            </p>
          </div>
        ))}
      </div>
      <ul style={{ margin: "12px 0 0", paddingLeft: 18 }}>
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </Panel>
  );
}

function SamplesPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.samples.length === 0) {
    return (
      <EmptyState
        badge="No samples yet"
        badgeTone="setup"
        title="Log your first field-completion sample"
        description="Each sample records how completely and quickly a form was filled while scouts trial a candidate schema."
      />
    );
  }
  const labelFor = (candidateId: string) =>
    view.candidates.find((c) => c.id === candidateId)?.label ?? "Unknown candidate";
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent samples</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.samples.slice(0, 25).map((sample) => (
          <li
            key={sample.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{labelFor(sample.candidateId)}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {sample.matchNumber != null ? `Match ${sample.matchNumber} · ` : ""}
                {sample.fieldsCompleted}/{sample.fieldsTotal} fields
                {sample.fillSeconds != null ? ` · ${sample.fillSeconds}s` : ""}
                {sample.hadError ? " · error flagged" : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => mutate({ action: "delete-sample", sampleId: sample.id })}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function NewCandidateForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ label: "", fieldCount: "", notes: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="schema-ab-add"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.label.trim()) return;
        mutate({
          action: "create-candidate",
          label: form.label,
          fieldCount: Number(form.fieldCount) || 0,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add schema candidate</h2>
      <FormGrid min={160}>
        <FormRow label="Label">
          <input value={form.label} onChange={set("label")} placeholder="Schema A - 2026 v3" required />
        </FormRow>
        <FormRow label="Field count">
          <input type="number" min={0} value={form.fieldCount} onChange={set("fieldCount")} />
        </FormRow>
        <FormRow label="Notes (optional)">
          <input value={form.notes} onChange={set("notes")} />
        </FormRow>
      </FormGrid>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.label.trim()}>
          Add candidate
        </Button>
      </div>
    </Panel>
  );
}

function LogSampleForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      candidateId: "",
      matchNumber: "",
      fieldsTotal: "",
      fieldsCompleted: "",
      fillSeconds: "",
      hadError: false,
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.candidateId || !form.fieldsTotal) return;
        mutate({
          action: "log-sample",
          candidateId: form.candidateId,
          matchNumber: form.matchNumber ? Number(form.matchNumber) : undefined,
          fieldsTotal: Number(form.fieldsTotal) || 0,
          fieldsCompleted: Number(form.fieldsCompleted) || 0,
          fillSeconds: form.fillSeconds ? Number(form.fillSeconds) : undefined,
          hadError: form.hadError,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log sample</h2>
      <FormGrid min={140}>
        <FormRow label="Candidate">
          <select value={form.candidateId} onChange={set("candidateId")} required>
            <option value="">Choose…</option>
            {view.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Match # (optional)">
          <input type="number" min={0} value={form.matchNumber} onChange={set("matchNumber")} />
        </FormRow>
        <FormRow label="Fields total">
          <input type="number" min={1} value={form.fieldsTotal} onChange={set("fieldsTotal")} required />
        </FormRow>
        <FormRow label="Fields completed">
          <input type="number" min={0} value={form.fieldsCompleted} onChange={set("fieldsCompleted")} />
        </FormRow>
        <FormRow label="Fill time (sec, optional)">
          <input type="number" min={0} value={form.fillSeconds} onChange={set("fillSeconds")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <input value={form.notes} onChange={set("notes")} />
      </FormRow>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={form.hadError}
          onChange={(event) => setForm((prev) => ({ ...prev, hadError: event.target.checked }))}
        />
        This entry had an error / confusion
      </label>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.candidateId || !form.fieldsTotal}>
          Log sample
        </Button>
      </div>
    </Panel>
  );
}
