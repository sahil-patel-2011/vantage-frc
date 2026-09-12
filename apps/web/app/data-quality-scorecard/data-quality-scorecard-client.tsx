"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import type { DataQualityScorecardView } from "../../lib/data-quality-scorecard/compute-data-quality-scorecard";
import type { DataQualityGrade } from "../../lib/data-quality-scorecard/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

function gradeTone(grade: DataQualityGrade): string {
  if (grade === "excellent") return "good";
  if (grade === "solid") return "setup";
  if (grade === "needs_attention") return "demo";
  return "demo";
}

function gradeLabel(grade: DataQualityGrade): string {
  switch (grade) {
    case "excellent":
      return "Excellent";
    case "solid":
      return "Solid";
    case "needs_attention":
      return "Needs attention";
    case "at_risk":
      return "At risk";
    default: {
      grade satisfies never;
      return "At risk";
    }
  }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

type LiveView = Extract<DataQualityScorecardView, { status: "live" }>;

function isDataQualityScorecardView(value: unknown): value is DataQualityScorecardView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function dataQualityCacheOrg(data: DataQualityScorecardView, orgHint: string): string {
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

async function persistDataQualitySnapshot(
  orgHint: string,
  seasonHint: string,
  data: DataQualityScorecardView,
): Promise<void> {
  const cacheOrg = dataQualityCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("data-quality-scorecard", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("data-quality-scorecard", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Data quality already painted; IndexedDB is best-effort.
  }
}

function DataQualityRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related scouting tools">
      <Button as="a" variant="secondary" href={hubHref("/competition", "scouting", orgId)}>
        Scouting
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/competition", "scout-training-mode", orgId)}>
        Training
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/scouting/lineup", orgId)}>
        Coverage
      </Button>
    </nav>
  );
}

function DataQualityNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "log",
      label: "Log a quality check",
      detail: "Record how complete a scouted match was, and whether a cross-check agreed.",
      href: "#data-quality-log",
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Live match and pit entries are the rows this scorecard grades.",
      href: hubHref("/competition", "scouting", orgId),
      primary: false,
    },
    {
      id: "training",
      label: "Open Training",
      detail: "New scouts practice on completed matches before they scout live.",
      href: hubHref("/competition", "scout-training-mode", orgId),
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

export default function DataQualityScorecardClient() {
  const [view, setView] = useState<DataQualityScorecardView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<DataQualityScorecardView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const seasonHint =
      seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<DataQualityScorecardView>(
        "data-quality-scorecard",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isDataQualityScorecardView(cached.data)) {
        setView(cached.data);
        setSeason(cached.data.seasonYear);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(
        `/api/data-quality-scorecard${query.toString() ? `?${query.toString()}` : ""}`,
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
        setErrorStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      if (!response.ok || !isDataQualityScorecardView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Data quality. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistDataQualitySnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Data quality. Showing the last copy on this device.");
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
        const response = await fetch("/api/data-quality-scorecard", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isDataQualityScorecardView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistDataQualitySnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const competitionHref = orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={competitionHref}>Competition</a>
          {" / Data quality"}
        </>
      }
      title="Data quality"
      description="Org scouting data-quality over the season — coverage against expected fields, cross-scout disagreement, and drift from consensus. Built only from what you log."
    >
      {view?.status === "live" && view.seasons.length > 0 ? (
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Season
          <select
            value={season ?? view.seasonYear}
            onChange={(event) => {
              const next = Number(event.target.value);
              setSeason(next);
              void load(next);
            }}
          >
            {view.seasons.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <DataQualityRelated orgId={orgId} />
    </PageHeader>
  );

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
        {header}
        <OfflineBanner feature="Data quality" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Opening Data quality"}
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
          <OfflineBanner feature="Data quality" fromCache={fromCache} cachedAt={cachedAt} />
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
      <OfflineBanner feature="Data quality" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <DataQualityNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <ScorecardPanel view={view} />
        <SummaryTiles view={view} />
        <LogCheckForm busy={busy} mutate={mutate} />
        {view.summary.totalChecks > 0 ? <Breakdowns view={view} /> : null}
        <RecentChecks view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function ScorecardPanel({ view }: { view: LiveView }) {
  const { scorecard } = view;
  const components = Object.entries(scorecard.components) as Array<[string, number]>;
  return (
    <Panel aria-label="Data quality score">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${gradeTone(scorecard.grade)}`}>{gradeLabel(scorecard.grade)}</span>
          <h2 style={{ margin: "6px 0 0" }}>Scouting data quality</h2>
          <small className="app-muted">
            {view.summary.totalChecks} check(s) logged · drift {view.summary.driftScore === null ? "n/a" : pct(view.summary.driftScore)}
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(scorecard.score)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {components.map(([key, value]) => (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "160px 1fr 48px", gap: 8, alignItems: "center" }}>
            <span className="app-muted" style={{ textTransform: "capitalize" }}>{key}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, value * 100)}%` }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>{pct(value)}</small>
          </div>
        ))}
      </div>
      {scorecard.recommendations.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Next steps</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {scorecard.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Checks logged", value: String(summary.totalChecks) },
    { label: "Coverage", value: pct(summary.coverage) },
    { label: "Disagreement rate", value: pct(summary.disagreementRate) },
    { label: "Cross-checked", value: String(summary.crossCheckedCount) },
    { label: "Drift", value: summary.driftScore === null ? "n/a" : pct(summary.driftScore) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Breakdowns({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}
    >
      <div>
        <h2 style={{ marginTop: 0 }}>By event</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byEvent.map((row) => (
            <li key={row.eventKey} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{row.eventKey}</span>
              <small className="app-muted">
                {row.checks} · cov {pct(row.coverage)} · dis {pct(row.disagreementRate)}
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By scout</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byScout.map((row) => (
            <li key={row.scoutName} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{row.scoutName}</span>
              <small className="app-muted">
                {row.checks} · cov {pct(row.coverage)} · dis {pct(row.disagreementRate)}
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By week</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.trend.map((row) => (
            <li key={row.week} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{row.week}</span>
              <small className="app-muted">
                {row.checks} · cov {pct(row.coverage)}
              </small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RecentChecks({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalChecks === 0) {
    return (
      <EmptyState
        badge="No checks yet"
        badgeTone="setup"
        title="Log your first data-quality check"
        description="Record how complete a scouted match was, and whether a cross-check with another scout agreed."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent checks</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.checks.slice(0, 20).map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>
                {item.eventKey}
                {item.matchKey ? ` · ${item.matchKey}` : ""}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.checkDate} · {item.scoutName} · {item.capturedDataPoints}/{item.expectedDataPoints} fields
              </small>
              <small className="app-muted">
                {item.crossChecked
                  ? item.agreement === null
                    ? "Cross-checked"
                    : item.agreement
                      ? "Cross-checked · agreed"
                      : "Cross-checked · disagreed"
                  : "Not cross-checked"}
                {item.deviationScore !== null ? ` · deviation ${pct(item.deviationScore)}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete check for ${item.eventKey}${item.matchKey ? ` ${item.matchKey}` : ""}?`)) {
                  mutate({ action: "delete-check", checkId: item.id });
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

function LogCheckForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      eventKey: "",
      matchKey: "",
      scoutName: "",
      checkDate: "",
      expectedDataPoints: "",
      capturedDataPoints: "",
      crossChecked: false,
      agreement: "" as "" | "true" | "false",
      deviationScore: "",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="data-quality-log"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.eventKey.trim() || !form.scoutName.trim() || !form.checkDate) return;
        mutate({
          action: "log-check",
          eventKey: form.eventKey,
          matchKey: form.matchKey || undefined,
          scoutName: form.scoutName,
          checkDate: form.checkDate,
          expectedDataPoints: Number(form.expectedDataPoints) || 0,
          capturedDataPoints: Number(form.capturedDataPoints) || 0,
          crossChecked: form.crossChecked || form.agreement !== "",
          agreement: form.agreement === "" ? null : form.agreement === "true",
          deviationScore: form.deviationScore === "" ? null : Number(form.deviationScore),
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a quality check</h2>
      <FormGrid min={160}>
        <FormRow label="Event key">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026casj" required />
        </FormRow>
        <FormRow label="Match (optional)">
          <input value={form.matchKey} onChange={set("matchKey")} placeholder="qm12" />
        </FormRow>
        <FormRow label="Scout name">
          <input value={form.scoutName} onChange={set("scoutName")} required />
        </FormRow>
        <FormRow label="Date">
          <input type="date" value={form.checkDate} onChange={set("checkDate")} required />
        </FormRow>
        <FormRow label="Expected fields">
          <input type="number" min={0} value={form.expectedDataPoints} onChange={set("expectedDataPoints")} />
        </FormRow>
        <FormRow label="Captured fields">
          <input type="number" min={0} value={form.capturedDataPoints} onChange={set("capturedDataPoints")} />
        </FormRow>
        <FormRow label="Cross-check agreement">
          <select value={form.agreement} onChange={set("agreement")}>
            <option value="">Not cross-checked</option>
            <option value="true">Agreed</option>
            <option value="false">Disagreed</option>
          </select>
        </FormRow>
        <FormRow label="Deviation (0-1, optional)">
          <input type="number" min={0} max={1} step={0.01} value={form.deviationScore} onChange={set("deviationScore")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={form.crossChecked || form.agreement !== ""}
          onChange={(event) => setForm((prev) => ({ ...prev, crossChecked: event.target.checked }))}
        />
        Cross-checked against another scout
      </label>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.eventKey.trim() || !form.scoutName.trim() || !form.checkDate}>
          Log check
        </Button>
      </div>
    </Panel>
  );
}
