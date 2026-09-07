"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type { DataQualityScorecardView } from "../../lib/data-quality-scorecard/compute-data-quality-scorecard";
import type { DataQualityGrade } from "../../lib/data-quality-scorecard/types";

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
    default:
      return "At risk";
  }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<DataQualityScorecardView, { status: "live" }>;

export default function DataQualityScorecardClient() {
  const [view, setView] = useState<DataQualityScorecardView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/data-quality-scorecard${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as DataQualityScorecardView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
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
        const response = await fetch("/api/data-quality-scorecard", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as DataQualityScorecardView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  // Retry cannot fix an expired session, so the failure decides its own action.
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
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Data Quality Scorecard"}
          </>
        }
        title="Data Quality Scorecard"
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
                load(next);
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
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState title={failure.title} description={failure.description}>
          {failure.primary ? (
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <ScorecardPanel view={view} />
          <SummaryTiles view={view} />
          <LogCheckForm busy={busy} mutate={mutate} />
          {view.summary.totalChecks > 0 ? <Breakdowns view={view} /> : null}
          <RecentChecks view={view} busy={busy} mutate={mutate} />
        </div>
      )}
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
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.eventKey.trim() || !form.scoutName.trim() || !form.checkDate}
        >
          Log check
        </button>
      </div>
    </Panel>
  );
}
