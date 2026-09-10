"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { BuildHubRelated } from "../../components/build-hub-related";
import { TEST_OUTCOMES, decisionRecommendationLabel, testOutcomeLabel } from "../../lib/prototype-tracker";
import type { PrototypeTrackerView } from "../../lib/prototype-tracker/compute-prototype-tracker";
import {
  PROTOTYPE_BUILD_RELATED_INCLUDE,
  decisionStatusLabel,
  formatMetricEvidence,
  outcomeBadgeTone,
  prototypeNextActions,
  prototypeStatusCounts,
  recommendationBadgeTone,
  shouldShowPrototypeSummaryTiles,
} from "../../lib/prototype-tracker/prototype-related";
import type { DecisionRecommendation, DecisionStatus, TestOutcome } from "../../lib/prototype-tracker/types";
import { hubHref } from "../../lib/nav/hubs";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./prototype-tracker.css";

type LiveView = Extract<PrototypeTrackerView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => Promise<void>;

function useHubEmbed(): "build" | null {
  const [embed, setEmbed] = useState<"build" | null>(null);
  useEffect(() => {
    if (window.location.pathname.startsWith("/build")) setEmbed("build");
    else setEmbed(null);
  }, []);
  return embed;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function badgeClass(tone: string): string {
  return tone ? `app-badge ${tone}` : "app-badge";
}

function NextActionsPanel({
  orgId,
  seasonYear,
  testCount,
  decisionCount,
  draftDecisionCount,
  testsWithoutDecision,
}: {
  orgId?: string | null;
  seasonYear: number;
  testCount: number;
  decisionCount: number;
  draftDecisionCount: number;
  testsWithoutDecision: number;
}) {
  const actions = prototypeNextActions({
    orgId,
    seasonYear,
    testCount,
    decisionCount,
    draftDecisionCount,
    testsWithoutDecision,
  });
  if (!actions.length) return null;
  return (
    <section className="ptk-next-actions app-card soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
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

function StatusTiles({ view }: { view: LiveView }) {
  if (!shouldShowPrototypeSummaryTiles({ testCount: view.tests.length })) return null;
  const draftDecisionCount = view.decisions.filter((d) => d.status === "draft").length;
  const successCount = view.tests.filter((t) => t.outcome === "success").length;
  const tiles = prototypeStatusCounts({
    testCount: view.tests.length,
    decisionCount: view.decisions.length,
    draftDecisionCount,
    successCount,
  });
  return (
    <div className="ptk-summary" aria-label="Prototype status">
      {tiles.map((tile) => (
        <div key={tile.id} className={["ptk-summary-tile", tile.tone].filter(Boolean).join(" ")}>
          <strong>{tile.value}</strong>
          <span>{tile.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function PrototypeTrackerClient(_props: { embedded?: boolean } = {}) {
  const embed = useHubEmbed();
  const [view, setView] = useState<PrototypeTrackerView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const crumbs = embed === "build" ? "Build / Prototypes" : (
    <>
      <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
      {" / Prototypes"}
    </>
  );

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setLoadError("");
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/prototype-tracker${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as PrototypeTrackerView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          setFetchFailed(true);
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

  const mutate = useCallback<Mutate>(
    async (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/prototype-tracker", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as PrototypeTrackerView | { error?: string };
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

  if (fetchFailed || view == null) {
    const copy = fetchFailed
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
      <main className="module-page ptk-page">
        <PageHeader
          breadcrumbs={crumbs}
          title="Prototype-to-Decision Tracker"
          description="Log a real prototype test — hypothesis, outcome, metric vs. target — then draft the design decision it informs."
        />
        <EmptyState
          soft
          title={copy ? copy.title : "Loading prototype tracker…"}
          description={copy ? copy.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {copy?.primary ? (
            <Button as="a" variant="primary" href={copy.primary.href}>
              {copy.primary.label}
            </Button>
          ) : null}
          {copy?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page ptk-page">
        <PageHeader
          breadcrumbs={crumbs}
          title="Prototype-to-Decision Tracker"
          description="Log a prototype test — hypothesis, outcome, metric vs. target — then draft the design decision and notebook entry it informs, grounded only in what you recorded."
        />
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="ptk-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <Button as="a" variant="secondary" href={step.href}>
                  Open
                </Button>
              </li>
            ))}
          </ol>
        </EmptyState>
        <NextActionsPanel
          orgId={view.orgId}
          seasonYear={view.seasonYear}
          testCount={0}
          decisionCount={0}
          draftDecisionCount={0}
          testsWithoutDecision={0}
        />
      </main>
    );
  }

  const decidedTestIds = new Set(view.decisions.map((d) => d.testId));
  const testsWithoutDecision = view.tests.filter((t) => !decidedTestIds.has(t.id)).length;
  const draftDecisionCount = view.decisions.filter((d) => d.status === "draft").length;
  const hasTests = view.tests.length > 0;

  return (
    <main className="module-page ptk-page">
      <PageHeader
        breadcrumbs={crumbs}
        title="Prototype-to-Decision Tracker"
        description="Log a prototype test — hypothesis, outcome, metric vs. target — then draft the design decision and notebook entry it informs, grounded only in what you recorded."
      >
        <div className="ptk-header-actions">
          {view.seasons.length > 0 ? (
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
          <Button as="a" variant="secondary" href={hubHref("/build", "fmea", orgId)}>
            FMEA
          </Button>
          <Button as="a" variant="secondary" href={hubHref("/build", "cad", orgId)}>
            CAD
          </Button>
          <Button as="a" variant="secondary" href={hubHref("/build", "kickoff", orgId)}>
            Kickoff
          </Button>
        </div>
      </PageHeader>

      {orgId ? (
        <BuildHubRelated
          orgId={orgId}
          active="prototype"
          include={[...PROTOTYPE_BUILD_RELATED_INCLUDE]}
          ariaLabel="Related build tools"
        />
      ) : null}

      {error ? (
        <p className="ptk-alert" role="alert">
          {error}
        </p>
      ) : null}

      <NextActionsPanel
        orgId={orgId}
        seasonYear={view.seasonYear}
        testCount={view.tests.length}
        decisionCount={view.decisions.length}
        draftDecisionCount={draftDecisionCount}
        testsWithoutDecision={testsWithoutDecision}
      />

      <StatusTiles view={view} />

      <div className="ptk-stack">
        <LogTestForm busy={busy} mutate={mutate} />

        {!hasTests ? (
          <EmptyState
            soft
            badge="No tests yet"
            badgeTone="setup"
            title="Log your first prototype test"
            description="Outcomes, metrics, and decision confidence stay blank until you record a real test — nothing is pre-filled."
          >
            <div className="ptk-empty-links">
              <a href={hubHref("/build", "fmea", orgId)}>FMEA →</a>
              <a href={hubHref("/build", "cad", orgId)}>CAD →</a>
              <a href={hubHref("/build", "kickoff", orgId)}>Kickoff →</a>
            </div>
          </EmptyState>
        ) : (
          <TestsList view={view} busy={busy} mutate={mutate} />
        )}

        <DecisionsList view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function TestsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  return (
    <Panel className="ptk-panel">
      <h2>Prototype tests</h2>
      <p className="lead app-muted">
        Outcomes and metrics from logged shop tests only.
      </p>
      <ul className="ptk-list">
        {view.tests.map((test) => {
          const metric = formatMetricEvidence(test);
          const tone = outcomeBadgeTone(test.outcome);
          return (
            <li key={test.id} className="ptk-card">
              <header className="ptk-card-top">
                <div className="ptk-card-title">
                  <div className="ptk-badges">
                    <span className={badgeClass(tone)}>{testOutcomeLabel(test.outcome)}</span>
                  </div>
                  <strong>{test.title}</strong>
                  <span className="ptk-card-meta">
                    {test.subsystemName} · {test.testDate}
                  </span>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete "${test.title}"?`)) {
                      void mutate({ action: "delete-test", testId: test.id });
                    }
                  }}
                >
                  Delete
                </button>
              </header>
              {test.hypothesis ? (
                <p className="ptk-hypothesis">
                  <strong>Hypothesis:</strong> {test.hypothesis}
                </p>
              ) : null}
              {test.resultSummary ? <p className="ptk-result">{test.resultSummary}</p> : null}
              {metric ? <span className="ptk-metric">{metric}</span> : null}
              <DraftDecisionForm test={test} busy={busy} mutate={mutate} />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function DraftDecisionForm({
  test,
  busy,
  mutate,
}: {
  test: LiveView["tests"][number];
  busy: boolean;
  mutate: Mutate;
}) {
  const [decisionTitle, setDecisionTitle] = useState(`Decide on ${test.title}`);
  return (
    <form
      className="ptk-draft-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!decisionTitle.trim()) return;
        void mutate({ action: "draft-decision", testId: test.id, decisionTitle });
      }}
    >
      <input
        value={decisionTitle}
        onChange={(event) => setDecisionTitle(event.target.value)}
        placeholder="Decision title"
      />
      <Button variant="secondary" type="submit" disabled={busy || !decisionTitle.trim()}>
        Draft decision
      </Button>
    </form>
  );
}

function DecisionsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  if (view.decisions.length === 0) {
    return (
      <EmptyState
        soft
        badge="No decisions yet"
        badgeTone="setup"
        title="No decision records drafted yet"
        description="Draft a decision from any logged test above. Recommendation and confidence come only from that test’s recorded outcome and metric."
      >
        <div className="ptk-empty-links">
          <a href={hubHref("/build", "cad", view.orgId)}>CAD →</a>
          <a href={hubHref("/build", "fmea", view.orgId)}>FMEA →</a>
        </div>
      </EmptyState>
    );
  }
  const testTitleById = new Map(view.tests.map((test) => [test.id, test.title]));
  return (
    <Panel className="ptk-panel">
      <h2>Decision records</h2>
      <p className="lead app-muted">
        Drafted from linked tests — confidence percentages are from recorded outcomes, not invented.
      </p>
      <ul className="ptk-list">
        {view.decisions.map((decision) => {
          const recTone = recommendationBadgeTone(decision.recommendation);
          const status = decision.status as DecisionStatus;
          const recommendation = decision.recommendation as DecisionRecommendation;
          return (
            <li key={decision.id} className="ptk-card">
              <header className="ptk-card-top">
                <div className="ptk-card-title">
                  <div className="ptk-badges">
                    <span className={badgeClass(recTone)}>
                      {decisionRecommendationLabel(recommendation)}
                    </span>
                    <span className={badgeClass(status === "finalized" ? "good" : "setup")}>
                      {decisionStatusLabel(status)}
                    </span>
                  </div>
                  <strong>{decision.decisionTitle}</strong>
                  <span className="ptk-card-meta">
                    {testTitleById.get(decision.testId) ?? "Linked test"} · confidence{" "}
                    {pct(decision.confidence)}
                  </span>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete "${decision.decisionTitle}"?`)) {
                      void mutate({ action: "delete-decision", decisionId: decision.id });
                    }
                  }}
                >
                  Delete
                </button>
              </header>
              <p className="ptk-result">{decision.decisionRecord}</p>
              <details>
                <summary className="app-muted">Notebook entry</summary>
                <pre className="ptk-notebook">{decision.notebookEntry}</pre>
              </details>
              {status === "draft" ? (
                <div>
                  <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "update-decision-status", decisionId: decision.id, status: "finalized", }) }>
                    Finalize
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function LogTestForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: Mutate;
}) {
  const empty = useMemo(
    () => ({
      subsystemName: "",
      title: "",
      hypothesis: "",
      testDate: "",
      outcome: "inconclusive" as TestOutcome,
      resultSummary: "",
      metricLabel: "",
      metricValue: "",
      metricTarget: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      className="ptk-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.subsystemName.trim() || !form.title.trim() || !form.testDate) return;
        void mutate({
          action: "log-test",
          subsystemName: form.subsystemName,
          title: form.title,
          hypothesis: form.hypothesis || undefined,
          testDate: form.testDate,
          outcome: form.outcome,
          resultSummary: form.resultSummary || undefined,
          metricLabel: form.metricLabel || undefined,
          metricValue: form.metricValue === "" ? undefined : Number(form.metricValue),
          metricTarget: form.metricTarget === "" ? undefined : Number(form.metricTarget),
        });
        setForm(empty);
      }}
    >
      <h2>Log a prototype test</h2>
      <p className="lead app-muted">
        Optional metrics stay blank until you measure them.
      </p>
      <FormGrid min={180}>
        <FormRow label="Subsystem">
          <input value={form.subsystemName} onChange={set("subsystemName")} placeholder="Climber" required />
        </FormRow>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Latch v2 load test" required />
        </FormRow>
        <FormRow label="Test date">
          <input type="date" value={form.testDate} onChange={set("testDate")} required />
        </FormRow>
        <FormRow label="Outcome">
          <select value={form.outcome} onChange={set("outcome")}>
            {TEST_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {testOutcomeLabel(outcome)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Metric label (optional)">
          <input value={form.metricLabel} onChange={set("metricLabel")} placeholder="Hold time (s)" />
        </FormRow>
        <FormRow label="Metric value (optional)">
          <input type="number" value={form.metricValue} onChange={set("metricValue")} />
        </FormRow>
        <FormRow label="Metric target (optional)">
          <input type="number" value={form.metricTarget} onChange={set("metricTarget")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Hypothesis (optional)">
        <textarea value={form.hypothesis} onChange={set("hypothesis")} rows={2} />
      </FormRow>
      <FormRow label="Result summary (optional)">
        <textarea value={form.resultSummary} onChange={set("resultSummary")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.subsystemName.trim() || !form.title.trim() || !form.testDate}>
          Log test
        </Button>
      </div>
    </Panel>
  );
}
