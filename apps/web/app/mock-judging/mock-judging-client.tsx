"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import {
  MOCK_JUDGING_AWARD_CATEGORIES,
  mockJudgingAwardCategoryLabel,
  mockJudgingCriterionLabel,
} from "../../lib/mock-judging";
import type { MockJudgingView } from "../../lib/mock-judging/compute-mock-judging";
import type { MockJudgingAwardCategory, MockJudgingCriterion } from "../../lib/mock-judging/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

function scoreTone(score: number): string {
  if (score >= 4) return "good";
  if (score >= 2.8) return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<MockJudgingView, { status: "live" }>;

function isMockJudgingView(value: unknown): value is MockJudgingView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function mockJudgingCacheOrg(data: MockJudgingView, orgHint: string): string {
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

async function persistMockJudgingSnapshot(
  orgHint: string,
  seasonHint: string,
  data: MockJudgingView,
): Promise<void> {
  const cacheOrg = mockJudgingCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("mock-judging", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("mock-judging", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Mock Judging already painted; IndexedDB is best-effort.
  }
}

function MockJudgingRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related judging tools">
      <Button as="a" variant="secondary" href={hubHref("/business", "judge-sim", orgId)}>
        Judge pitch
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/business", "impact-essay", orgId)}>
        Impact essay
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/competition", "district-advancement", orgId)}>
        Districts
      </Button>
    </nav>
  );
}

function MockJudgingNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "session",
      label: "Run a mock judging round",
      detail: "Answer a judging question and get a rubric-scored breakdown.",
      href: "#mock-judging-session",
      primary: true,
    },
    {
      id: "pitch",
      label: "Open Judge pitch",
      detail: "Timed pitch practice uses the same award prep as this board.",
      href: hubHref("/business", "judge-sim", orgId),
      primary: false,
    },
    {
      id: "essay",
      label: "Open Impact essay",
      detail: "Written award drafts sit next to these practice sessions.",
      href: hubHref("/business", "impact-essay", orgId),
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

export default function MockJudgingClient() {
  const [view, setView] = useState<MockJudgingView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<MockJudgingView | null>(null);
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
      const cached = await getFeatureSnapshot<MockJudgingView>("mock-judging", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isMockJudgingView(cached.data)) {
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
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/mock-judging${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
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
      if (!response.ok || !isMockJudgingView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Mock Judging. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistMockJudgingSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Mock Judging. Showing the last copy on this device.");
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
        const response = await fetch("/api/mock-judging", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isMockJudgingView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistMockJudgingSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const businessHref = orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={businessHref}>Business</a>
          {" / Mock Judging"}
        </>
      }
      title="Mock Judging"
      description="Run practice judging sessions with a rubric scored from your own prep notes — substance, specificity, evidence, clarity, and confidence before you are in front of real judges."
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
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
        <MockJudgingRelated orgId={orgId} />
      </div>
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
        <OfflineBanner feature="Mock Judging" fromCache={fromCache} cachedAt={cachedAt} />
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
          <OfflineBanner feature="Mock Judging" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
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
      <OfflineBanner feature="Mock Judging" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <MockJudgingNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <ReadinessPanel view={view} />
        <RunSessionForm busy={busy} mutate={mutate} />
        <SessionsList view={view} busy={busy} mutate={mutate} />
        <PrepNoteForm busy={busy} mutate={mutate} />
        <PrepNotesList view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  const tiles = [
    { label: "Sessions scored", value: String(readiness.totalSessions) },
    { label: "Strong (4+/5)", value: String(readiness.strongSessionCount) },
    { label: "Needs work (<2.8/5)", value: String(readiness.weakSessionCount) },
    { label: "Categories covered", value: String(readiness.categoriesCovered) },
    { label: "Prep notes logged", value: String(readiness.notesCount) },
  ];
  return (
    <Panel aria-label="Mock judging readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0" }}>Judging readiness</h2>
          <small className="app-muted">Mean rubric score across this season's practice sessions</small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(readiness.score)}</strong>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
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

function RunSessionForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [awardCategory, setAwardCategory] = useState<MockJudgingAwardCategory>("general");
  const [question, setQuestion] = useState("");
  const [answerText, setAnswerText] = useState("");

  return (
    <Panel
      id="mock-judging-session"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!answerText.trim()) return;
        mutate({
          action: "run-session",
          awardCategory,
          question: question || undefined,
          answerText,
        });
        setQuestion("");
        setAnswerText("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Run a mock judging round</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Leave the question blank to get one picked for you from the award category, then answer it like you would in
        front of judges. The rubric judge scores your answer deterministically and grounds feedback in your logged prep notes.
      </p>
      <FormGrid min={160}>
        <FormRow label="Award category">
          <select value={awardCategory} onChange={(event) => setAwardCategory(event.target.value as MockJudgingAwardCategory)}>
            {MOCK_JUDGING_AWARD_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {mockJudgingAwardCategoryLabel(category)}
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
          Score answer
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
        badge="No sessions yet"
        badgeTone="setup"
        title="Run your first mock judging round"
        description="Answer a judging question above and get a rubric-scored breakdown across five criteria."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Scored sessions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.sessions.slice(0, 20).map((item) => (
          <li key={item.id} style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${scoreTone(item.overallScore)}`}>{item.overallScore}/5</span>
                <strong style={{ display: "block", marginTop: 4 }}>{item.question}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {mockJudgingAwardCategoryLabel(item.awardCategory)}
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {(Object.entries(item.criteriaScores) as Array<[MockJudgingCriterion, number]>).map(([criterion, value]) => (
                <small key={criterion} className="app-muted">
                  {mockJudgingCriterionLabel(criterion)}: {value}/5
                </small>
              ))}
            </div>
            <small className="app-muted">{item.feedback}</small>
            {item.improvements.length > 0 ? (
              <div>
                <strong className="app-muted">Improve</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {item.improvements.map((tip) => (
                    <li key={tip}>{tip}</li>
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

function PrepNoteForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      title: "",
      note: "",
      awardCategory: "general" as MockJudgingAwardCategory,
      tags: "",
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
        if (!form.title.trim() || !form.note.trim()) return;
        mutate({
          action: "log-note",
          title: form.title,
          note: form.note,
          awardCategory: form.awardCategory,
          tags: form.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a prep note</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Talking points and facts your team can point to for judges. Answers are scored higher for evidence grounding
        when they overlap with what's logged here.
      </p>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Regional STEM night" required />
        </FormRow>
        <FormRow label="Award category">
          <select value={form.awardCategory} onChange={set("awardCategory")}>
            {MOCK_JUDGING_AWARD_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {mockJudgingAwardCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Tags (comma-separated, optional)">
          <input value={form.tags} onChange={set("tags")} placeholder="outreach, stem" />
        </FormRow>
      </FormGrid>
      <FormRow label="Note">
        <textarea
          value={form.note}
          onChange={set("note")}
          rows={2}
          placeholder="We ran a STEM outreach night reaching 300 local elementary students."
          required
        />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim() || !form.note.trim()}>
          Log note
        </Button>
      </div>
    </Panel>
  );
}

function PrepNotesList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.notes.length === 0) {
    return (
      <EmptyState
        badge="No prep notes yet"
        badgeTone="setup"
        title="Log your first prep note"
        description="Without logged notes, the rubric judge can't ground evidence-grounding scores in anything specific."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Prep notes</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.notes.slice(0, 30).map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {mockJudgingAwardCategoryLabel(item.awardCategory)}
                {item.tags.length ? ` · ${item.tags.join(", ")}` : ""}
              </small>
              <small className="app-muted">{item.note}</small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${item.title}"?`)) {
                  mutate({ action: "delete-note", noteId: item.id });
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
