"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { JUDGE_SIM_CATEGORIES, judgeSimCategoryLabel, judgeSimVerdictLabel } from "../../lib/judge-sim";
import type { JudgeSimView } from "../../lib/judge-sim/compute-judge-sim";
import {
  JUDGE_SIM_RELATED_INCLUDE,
  classifyJudgeSimShell,
  formatJudgeSimMetric,
  formatJudgeSimReadiness,
  judgeSimNextActions,
  judgeSimRelatedLinks,
  judgeSimShellCopy,
  shouldShowJudgeSimSummaryTiles,
  type JudgeSimNextAction,
  type JudgeSimShellKind,
} from "../../lib/judge-sim/judge-sim-related";
import type { JudgeSimCategory, JudgeSimVerdict } from "../../lib/judge-sim/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./judge-sim.css";

function isJudgeSimView(value: unknown): value is JudgeSimView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function judgeSimCacheOrg(data: JudgeSimView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistJudgeSimSnapshot(
  orgHint: string,
  seasonHint: string,
  data: JudgeSimView,
): Promise<void> {
  const cacheOrg = judgeSimCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("judge-sim", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("judge-sim", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Judge pitch already painted; IndexedDB is best-effort.
  }
}

function verdictTone(verdict: JudgeSimVerdict): string {
  if (verdict === "well_backed") return "good";
  if (verdict === "partially_backed") return "setup";
  return "demo";
}

type LiveView = Extract<JudgeSimView, { status: "live" }>;

function JudgeSimRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = judgeSimRelatedLinks(orgId, {
    include: [...JUDGE_SIM_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related judge-sim-related" aria-label="Related business tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function JudgeSimNextActionsPanel({ actions }: { actions: JudgeSimNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions judge-sim-next-actions"
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

function JudgeSimShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: JudgeSimShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = judgeSimNextActions({ orgId, shell });
  const copy = judgeSimShellCopy(shell);
  const businessHref = hubWorkbenchHref("business", "judge-sim", orgId);
  const impactHref = hubHref("/business", "impact", orgId);

  return (
    <main className="module-page judge-sim-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Judge pitch"}
          </>
        }
        title="Judge pitch"
        description={description}
      >
        <JudgeSimRelatedStrip orgId={orgId} />
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
                ? "No sessions yet"
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
          <Button as="a" variant="primary" href={impactHref}>Open Impact</Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <JudgeSimNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function JudgeSimClient() {
  const [view, setView] = useState<JudgeSimView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<JudgeSimView | null>(null);
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
        const cached = await getFeatureSnapshot<JudgeSimView>(
          "judge-sim",
          urlOrg || "_",
          seasonHint,
        );
        if (!viewRef.current && cached?.data && isJudgeSimView(cached.data)) {
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
          `/api/judge-sim${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as JudgeSimView | { error?: string };
        if (!response.ok || !isJudgeSimView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Judge pitch. Showing the last copy on this device.");
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
        await persistJudgeSimSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Judge pitch. Showing the last copy on this device.");
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
  const sessionCount = view?.status === "live" ? view.sessions.length : 0;
  const evidenceCount = view?.status === "live" ? view.evidence.length : 0;
  const wellBackedCount = view?.status === "live" ? view.readiness.wellBackedCount : 0;
  const unbackedCount = view?.status === "live" ? view.readiness.unbackedCount : 0;
  const readinessScore = view?.status === "live" ? view.readiness.score : 0;

  const shell = classifyJudgeSimShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    sessionCount,
  });
  const shellCopy = judgeSimShellCopy(shell);
  const nextActions = judgeSimNextActions({
    orgId,
    shell,
    sessionCount,
    evidenceCount,
  });
  const relatedLinks = judgeSimRelatedLinks(orgId, {
    include: [...JUDGE_SIM_RELATED_INCLUDE],
  });
  const businessHref = hubWorkbenchHref("business", "judge-sim", orgId);
  const impactHref = hubHref("/business", "impact", orgId);
  const essayHref = hubHref("/business", "impact-essay", orgId);
  const awardsHref = hubHref("/business", "evidence", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/judge-sim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as JudgeSimView | { error?: string };
        if (!response.ok || !isJudgeSimView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        void persistJudgeSimSnapshot(orgId, season != null ? String(season) : "", data);
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
      <JudgeSimShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Judge pitch" fromCache={fromCache} cachedAt={cachedAt} />
      </JudgeSimShell>
    );
  }

  if (shell === "error") {
    return (
      <JudgeSimShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Judge pitch" fromCache={fromCache} cachedAt={cachedAt} />
      </JudgeSimShell>
    );
  }

  if (shell === "setup") {
    return (
      <JudgeSimShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Judge pitch" fromCache={fromCache} cachedAt={cachedAt} />
      </JudgeSimShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <JudgeSimShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Judge pitch" fromCache={fromCache} cachedAt={cachedAt} />
      </JudgeSimShell>
    );
  }

  return (
    <main className="module-page judge-sim-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Judge pitch"}
          </>
        }
        title="Judge pitch"
        description="Practice judge Q&A and get graded against your own logged evidence — any claim you can't back gets flagged before a real judge catches it. Cross-check Impact, Impact essay, and Awards."
      >
        <div className="judge-sim-header-actions">
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
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>
      <OfflineBanner feature="Judge pitch" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <JudgeSimNextActionsPanel actions={shell === "ready" ? nextActions : []} />

      {shouldShowJudgeSimSummaryTiles(sessionCount) ? (
        <section className="judge-sim-stats" aria-label="Judge pitch counts">
          <div>
            <strong>{formatJudgeSimReadiness(readinessScore, sessionCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Well-backed share
            </span>
          </div>
          <div>
            <strong>{formatJudgeSimMetric(sessionCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Sessions graded
            </span>
          </div>
          <div>
            <strong>{formatJudgeSimMetric(wellBackedCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Well backed
            </span>
          </div>
          <div>
            <strong>{formatJudgeSimMetric(unbackedCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Unbacked
            </span>
          </div>
          <div>
            <strong>{formatJudgeSimMetric(evidenceCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Evidence logged
            </span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No sessions yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href="#judge-sim-evidence">
            Log evidence
          </Button>
        </EmptyState>
      ) : null}

      <div className="judge-sim-layout">
        <RunSessionForm busy={busy} mutate={mutate} />
        <SessionsList view={view} busy={busy} mutate={mutate} />
        <EvidenceLogForm busy={busy} mutate={mutate} />
        <EvidenceList view={view} busy={busy} mutate={mutate} />
        <Panel className="judge-sim-tip" aria-label="Judge pitch tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep outreach facts in <a href={impactHref}>Impact</a>, draft award language in{" "}
            <a href={essayHref}>Impact essay</a>, and upload packets in <a href={awardsHref}>Awards</a>
          </p>
        </Panel>
      </div>
    </main>
  );
}

function RunSessionForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [category, setCategory] = useState<JudgeSimCategory>("technical");
  const [question, setQuestion] = useState("");
  const [answerText, setAnswerText] = useState("");

  return (
    <Panel
      id="judge-sim-session"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!answerText.trim()) return;
        mutate({
          action: "run-session",
          category,
          question: question || undefined,
          answerText,
        });
        setQuestion("");
        setAnswerText("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Ask a judge question</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Leave the question blank to get one picked for you from the judging category, then answer it like you would
        in a real interview. Your answer is graded against evidence you&apos;ve logged below.
      </p>
      <FormGrid min={160}>
        <FormRow label="Category">
          <select value={category} onChange={(event) => setCategory(event.target.value as JudgeSimCategory)}>
            {JUDGE_SIM_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {judgeSimCategoryLabel(cat)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Question (optional)">
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Leave blank for a picked question" />
        </FormRow>
      </FormGrid>
      <FormRow label="Your answer">
        <textarea
          value={answerText}
          onChange={(event) => setAnswerText(event.target.value)}
          rows={4}
          placeholder="Answer like you're in front of judges…"
          required
        />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !answerText.trim()}>
          Grade answer
        </Button>
      </div>
    </Panel>
  );
}

function SessionsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.sessions.length === 0) {
    return (
      <EmptyState
        soft
        badge="No sessions yet"
        badgeTone="setup"
        title="Run your first judge Q&A"
        description="Ask yourself a judging question above and see which claims are backed by your evidence log."
      />
    );
  }
  return (
    <Panel id="judge-sim-sessions">
      <h2 style={{ marginTop: 0 }}>Graded sessions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.sessions.slice(0, 20).map((item) => (
          <li key={item.id} style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${verdictTone(item.verdict)}`}>{judgeSimVerdictLabel(item.verdict)}</span>
                <strong style={{ display: "block", marginTop: 4 }}>{item.question}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {judgeSimCategoryLabel(item.category)} · confidence {Math.round(item.confidence * 100)}%
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this session?")) {
                    mutate({ action: "delete-session", sessionId: item.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
            <p style={{ margin: 0 }}>{item.answerText}</p>
            <small className="app-muted">{item.feedback}</small>
            {item.flaggedClaims.length > 0 ? (
              <div>
                <strong className="app-muted">Unbackable claims</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {item.flaggedClaims.map((claim) => (
                    <li key={claim}>{claim}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EvidenceLogForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      title: "",
      claim: "",
      category: "technical" as JudgeSimCategory,
      sourceUrl: "",
      occurredOn: "",
      tags: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="judge-sim-evidence"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim() || !form.claim.trim()) return;
        mutate({
          action: "log-evidence",
          title: form.title,
          claim: form.claim,
          category: form.category,
          sourceUrl: form.sourceUrl || undefined,
          occurredOn: form.occurredOn || undefined,
          tags: form.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log evidence</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Facts you can actually point to for judges — numbers, events, outcomes. Answers are only graded as
        &quot;backed&quot; against what&apos;s logged here.
      </p>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Regional STEM night" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {JUDGE_SIM_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {judgeSimCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Date (optional)">
          <input type="date" value={form.occurredOn} onChange={set("occurredOn")} />
        </FormRow>
        <FormRow label="Source URL (optional)">
          <input value={form.sourceUrl} onChange={set("sourceUrl")} placeholder="https://…" />
        </FormRow>
        <FormRow label="Tags (comma-separated, optional)">
          <input value={form.tags} onChange={set("tags")} placeholder="outreach, stem" />
        </FormRow>
      </FormGrid>
      <FormRow label="Claim / fact">
        <textarea
          value={form.claim}
          onChange={set("claim")}
          rows={2}
          placeholder="We ran a STEM outreach night reaching 300 local elementary students."
          required
        />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim() || !form.claim.trim()}>
          Log evidence
        </Button>
      </div>
    </Panel>
  );
}

function EvidenceList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.evidence.length === 0) {
    return (
      <EmptyState
        soft
        badge="No evidence yet"
        badgeTone="setup"
        title="Log your first piece of evidence"
        description="Without logged evidence, every claim in an answer will be flagged as unbacked."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Evidence log</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.evidence.slice(0, 30).map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {judgeSimCategoryLabel(item.category)}
                {item.occurredOn ? ` · ${item.occurredOn}` : ""}
                {item.tags.length ? ` · ${item.tags.join(", ")}` : ""}
              </small>
              <small className="app-muted">{item.claim}</small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${item.title}"?`)) {
                  mutate({ action: "delete-evidence", evidenceId: item.id });
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
