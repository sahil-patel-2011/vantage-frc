"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import {
  RULE_CHANGE_CATEGORIES,
  RULE_CHANGE_SEVERITIES,
  SUBSYSTEM_CATEGORIES,
  ruleChangeCategoryLabel,
  ruleChangeSeverityLabel,
  ruleImpactStatusLabel,
  subsystemCategoryLabel,
} from "../../lib/rule-impact";
import type { RuleImpactView } from "../../lib/rule-impact/compute-rule-impact";
import {
  RULE_IMPACT_RELATED_INCLUDE,
  classifyRuleImpactShell,
  formatRuleImpactConfidencePct,
  formatRuleImpactMetric,
  ruleImpactNextActions,
  ruleImpactRelatedLinks,
  ruleImpactShellCopy,
  type RuleImpactNextAction,
  type RuleImpactShellKind,
} from "../../lib/rule-impact/rule-impact-related";
import type {
  RuleChangeCategory,
  RuleChangeSeverity,
  RuleImpactStatus,
  SubsystemCategory,
} from "../../lib/rule-impact/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./rule-impact.css";

function statusTone(status: RuleImpactStatus): string {
  if (status === "still_legal") return "good";
  if (status === "needs_rework") return "setup";
  return "demo";
}

function severityTone(severity: RuleChangeSeverity): string {
  if (severity === "blocking") return "demo";
  if (severity === "major") return "setup";
  return "good";
}

type LiveView = Extract<RuleImpactView, { status: "live" }>;

function isRuleImpactView(value: unknown): value is RuleImpactView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function ruleImpactCacheOrg(data: RuleImpactView, orgHint: string): string {
  if ("orgId" in data && typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistRuleImpactSnapshot(
  orgHint: string,
  seasonHint: string,
  data: RuleImpactView,
): Promise<void> {
  const cacheOrg = ruleImpactCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("rule-impact", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("rule-impact", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Rule Impact Analyzer already painted; IndexedDB is best-effort.
  }
}

function RuleImpactRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = ruleImpactRelatedLinks(orgId, {
    include: [...RULE_IMPACT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related rule-impact-related" aria-label="Related build tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function RuleImpactNextActionsPanel({ actions }: { actions: RuleImpactNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions rule-impact-next-actions"
      aria-label="Next actions"
    >
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

function RuleImpactShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: RuleImpactShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = ruleImpactNextActions({ orgId, shell });
  const copy = ruleImpactShellCopy(shell);
  const buildHref = hubWorkbenchHref("build", "rule-impact", orgId);

  return (
    <main className="module-page rule-impact-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Rule Impact Analyzer"}
          </>
        }
        title="Rule Impact Analyzer"
        description={description}
      >
        <RuleImpactRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No rule changes yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href="#rule-impact-log-change">Log a rule change</Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <RuleImpactNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function RuleImpactClient() {
  const [view, setView] = useState<RuleImpactView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<RuleImpactView | null>(null);
  viewRef.current = view;

  const load = useCallback((seasonOverride?: number) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seasonQuery =
        seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
      const seasonHint =
        seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<RuleImpactView>(
          "rule-impact",
          urlOrg || "_",
          seasonHint,
        );
        if (!viewRef.current && cached?.data && isRuleImpactView(cached.data)) {
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
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (seasonHint) query.set("season", seasonHint);
      try {
        const response = await fetch(
          `/api/rule-impact${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as RuleImpactView | { error?: string };
        if (!response.ok || !isRuleImpactView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Rule Impact Analyzer. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        setCachedAt(null);
        await persistRuleImpactSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Rule Impact Analyzer. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const ruleChangeCount = view?.status === "live" ? view.ruleChanges.length : 0;
  const candidateCount = view?.status === "live" ? view.candidates.length : 0;
  const blockedCount =
    view?.status === "live"
      ? view.candidates.filter((row) => row.impactStatus === "blocked").length
      : 0;
  const openAssessmentCount =
    view?.status === "live"
      ? view.assessments.filter((row) => row.status === "open").length
      : 0;

  const shell = classifyRuleImpactShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    ruleChangeCount,
  });
  const shellCopy = ruleImpactShellCopy(shell);
  const nextActions = ruleImpactNextActions({
    orgId,
    shell,
    ruleChangeCount,
    candidateCount,
    blockedCount,
    openAssessmentCount,
  });
  const relatedLinks = ruleImpactRelatedLinks(orgId, {
    include: [...RULE_IMPACT_RELATED_INCLUDE],
  });
  const buildHref = hubWorkbenchHref("build", "rule-impact", orgId);
  const kickoffHref = hubHref("/build", "kickoff", orgId);
  const cadHref = hubHref("/build", "cad", orgId);
  const subsystemsHref = withOrgHref("/subsystems", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/rule-impact", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as RuleImpactView | { error?: string };
        if (!response.ok || !isRuleImpactView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        void persistRuleImpactSnapshot(orgId, season != null ? String(season) : "", data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  if (shell === "loading") {
    return (
      <RuleImpactShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Rule Impact Analyzer" fromCache={fromCache} cachedAt={cachedAt} />
      </RuleImpactShell>
    );
  }

  if (shell === "error") {
    return (
      <RuleImpactShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Rule Impact Analyzer" fromCache={fromCache} cachedAt={cachedAt} />
      </RuleImpactShell>
    );
  }

  if (shell === "setup") {
    return (
      <RuleImpactShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Rule Impact Analyzer" fromCache={fromCache} cachedAt={cachedAt} />
      </RuleImpactShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <RuleImpactShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Rule Impact Analyzer" fromCache={fromCache} cachedAt={cachedAt} />
      </RuleImpactShell>
    );
  }

  return (
    <main className="module-page rule-impact-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Rule Impact Analyzer"}
          </>
        }
        title="Rule Impact Analyzer"
        description="Log this season's game-manual rule changes and diff them against your subsystem library — still-legal, rework, or blocked from logged rules only. Cross-check Kickoff, CAD, and Subsystems."
      >
        <div className="rule-impact-header-actions">
          {view.seasons.length > 0 ? (
            <label className="app-muted rule-impact-season">
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
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <OfflineBanner feature="Rule Impact Analyzer" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <RuleImpactNextActionsPanel actions={nextActions} />

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No rule changes yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href="#rule-impact-log-change">
            Log a rule change
          </Button>
        </EmptyState>
      ) : null}

      <SummaryTiles view={view} loaded />

      <div className="rule-impact-layout">
        <RuleChangeForm busy={busy} mutate={mutate} />
        <RuleChangeList view={view} busy={busy} mutate={mutate} />
        {view.candidates.length > 0 ? (
          <CandidateList view={view} busy={busy} mutate={mutate} />
        ) : (
          <EmptyState
            soft
            badge="No subsystem history"
            badgeTone="setup"
            title="No prior-season subsystems on file"
            description="Log robot subsystems so Rule Impact can diff them against logged rule changes — empty means nothing on file."
          >
            <Button as="a" variant="primary" href={subsystemsHref}>
              Open Subsystems
            </Button>
          </EmptyState>
        )}
        <AssessmentList view={view} busy={busy} mutate={mutate} />
        <Panel className="rule-impact-tip" aria-label="Impact tip">
          <span className="eyebrow">Reuse path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep{" "}
            <a href={kickoffHref}>Kickoff</a> rule notes aligned with logged deltas, verify geometry in{" "}
            <a href={cadHref}>CAD</a>, and match candidate names to{" "}
            <a href={subsystemsHref}>Subsystems</a>
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SummaryTiles({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const blocked = view.candidates.filter((row) => row.impactStatus === "blocked").length;
  const needsRework = view.candidates.filter((row) => row.impactStatus === "needs_rework").length;
  const tiles = [
    { label: "Rule changes", value: formatRuleImpactMetric(view.ruleChanges.length, loaded) },
    { label: "Candidates", value: formatRuleImpactMetric(view.candidates.length, loaded) },
    { label: "Needs rework", value: formatRuleImpactMetric(needsRework, loaded) },
    { label: "Blocked", value: formatRuleImpactMetric(blocked, loaded) },
    { label: "Assessments", value: formatRuleImpactMetric(view.assessments.length, loaded) },
  ];
  return (
    <Panel className="rule-impact-coverage" aria-label="Rule Impact summary">
      <div className="rule-impact-stats">
        <div>
          <span
            className={`app-badge ${
              view.ruleChanges.length === 0 ? "setup" : view.candidates.length === 0 ? "setup" : "good"
            }`}
          >
            {view.ruleChanges.length === 0 ? "EMPTY" : view.candidates.length === 0 ? "NO HISTORY" : "LIVE"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Season impact</h2>
          <small className="app-muted">Logged rules × prior subsystems only.</small>
        </div>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong>{tile.value}</strong>
            <small className="app-muted" style={{ display: "block" }}>
              {tile.label}
            </small>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RuleChangeForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      ruleCode: "",
      title: "",
      category: "dimension" as RuleChangeCategory,
      severity: "minor" as RuleChangeSeverity,
      subsystemCategory: "" as SubsystemCategory | "",
      summary: "",
      sourceUrl: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="rule-impact-log-change"
      as="form"
      className="rule-impact-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.ruleCode.trim() || !form.title.trim()) return;
        mutate({
          action: "log-rule-change",
          ruleCode: form.ruleCode,
          title: form.title,
          category: form.category,
          severity: form.severity,
          subsystemCategory: form.subsystemCategory || undefined,
          summary: form.summary || undefined,
          sourceUrl: form.sourceUrl || undefined,
        });
        setForm(empty);
      }}
    >
      <h2 style={{ margin: 0 }}>Log a rule change</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Add each game-manual change once you have checked it against the official manual.
      </p>
      <FormGrid min={160}>
        <FormRow label="Rule code">
          <input value={form.ruleCode} onChange={set("ruleCode")} placeholder="R301" required />
        </FormRow>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Cage height reduced" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {RULE_CHANGE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {ruleChangeCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Severity">
          <select value={form.severity} onChange={set("severity")}>
            {RULE_CHANGE_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {ruleChangeSeverityLabel(severity)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Subsystem category (optional)">
          <select value={form.subsystemCategory} onChange={set("subsystemCategory")}>
            <option value="">Applies to all subsystems</option>
            {SUBSYSTEM_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {subsystemCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Source URL (optional)">
          <input value={form.sourceUrl} onChange={set("sourceUrl")} placeholder="https://…" />
        </FormRow>
      </FormGrid>
      <FormRow label="Summary (optional)">
        <textarea value={form.summary} onChange={set("summary")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.ruleCode.trim() || !form.title.trim()}>
          Log rule change
        </Button>
      </div>
    </Panel>
  );
}

function RuleChangeList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.ruleChanges.length === 0) {
    return (
      <EmptyState
        soft
        badge="No rule changes logged"
        badgeTone="setup"
        title="Log this season's rule changes"
        description="Add each new-season game-manual delta above to start diffing it against your subsystem library."
      />
    );
  }
  return (
    <Panel className="rule-impact-panel">
      <h2 style={{ marginTop: 0 }}>
        Logged rule changes ({formatRuleImpactMetric(view.ruleChanges.length, true)})
      </h2>
      <ul className="rule-impact-list">
        {view.ruleChanges.map((rule) => (
          <li key={rule.id} className="rule-impact-card">
            <div>
              <span className={`app-badge ${severityTone(rule.severity)}`}>
                {ruleChangeSeverityLabel(rule.severity)}
              </span>{" "}
              <strong>{rule.ruleCode}</strong> — {rule.title}
              <small className="app-muted" style={{ display: "block" }}>
                {ruleChangeCategoryLabel(rule.category)}
                {rule.subsystemCategory
                  ? ` · ${subsystemCategoryLabel(rule.subsystemCategory)}`
                  : " · applies to all subsystems"}
                {rule.summary ? ` · ${rule.summary}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete rule "${rule.ruleCode}"?`)) {
                  mutate({ action: "delete-rule-change", ruleChangeId: rule.id });
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

function CandidateList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel id="rule-impact-candidates" className="rule-impact-panel">
      <h2 style={{ marginTop: 0 }}>
        Subsystem impact ({formatRuleImpactMetric(view.candidates.length, true)})
      </h2>
      <ul className="rule-impact-list">
        {view.candidates.map((candidate) => (
          <li key={candidate.subsystemId} className="rule-impact-card">
            <div>
              <span className={`app-badge ${statusTone(candidate.impactStatus)}`}>
                {ruleImpactStatusLabel(candidate.impactStatus)}
              </span>{" "}
              <strong>{candidate.subsystemName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {subsystemCategoryLabel(candidate.category)} · {candidate.sourceSeasonYear} ·{" "}
                {candidate.motorType}
                {candidate.motorCount ? ` ×${candidate.motorCount}` : ""} ·{" "}
                {formatRuleImpactConfidencePct(candidate.confidence, true, true)} confidence
              </small>
              <small className="app-muted" style={{ display: "block" }}>
                {candidate.rationale}
              </small>
              {candidate.matchedRules.length > 0 ? (
                <small className="app-muted" style={{ display: "block" }}>
                  Matched: {candidate.matchedRules.map((rule) => rule.ruleCode).join(", ")}
                </small>
              ) : null}
            </div>
            <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "assess", subsystemId: candidate.subsystemId, subsystemName: candidate.subsystemName, category: candidate.category, sourceSeasonYear: candidate.sourceSeasonYear, }) }>
              {candidate.alreadyAssessed ? "Reassess" : "Assess"}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AssessmentList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.assessments.length === 0) {
    return (
      <EmptyState
        soft
        badge="No assessments yet"
        badgeTone="setup"
        title="Assess a subsystem above"
        description="Persisted assessments — including status changes as you triage them — appear here from real assess actions only."
      />
    );
  }
  return (
    <Panel id="rule-impact-assessments" className="rule-impact-panel">
      <h2 style={{ marginTop: 0 }}>
        Assessments ({formatRuleImpactMetric(view.assessments.length, true)})
      </h2>
      <ul className="rule-impact-list">
        {view.assessments.map((assessment) => (
          <li key={assessment.id} className="rule-impact-card">
            <div>
              <span className={`app-badge ${statusTone(assessment.impactStatus)}`}>
                {ruleImpactStatusLabel(assessment.impactStatus)}
              </span>{" "}
              <strong>{assessment.subsystemName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {subsystemCategoryLabel(assessment.category)} · {assessment.matchedRuleCount} matched
                rule(s) · {formatRuleImpactConfidencePct(assessment.confidence, true, true)} confidence ·{" "}
                {assessment.status}
              </small>
              <small className="app-muted" style={{ display: "block" }}>
                {assessment.rationale}
              </small>
            </div>
            <div className="rule-impact-card-actions">
              {assessment.status === "open" ? (
                <>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      mutate({ action: "update-status", assessmentId: assessment.id, status: "accepted" })
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      mutate({ action: "update-status", assessmentId: assessment.id, status: "dismissed" })
                    }
                  >
                    Dismiss
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete assessment for "${assessment.subsystemName}"?`)) {
                    mutate({ action: "delete-assessment", assessmentId: assessment.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
