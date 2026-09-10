"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { decisionCategoryLabel, decisionStatusLabel } from "../../lib/decisions";
import {
  DECISION_CATEGORIES,
  DECISION_STATUSES,
  type DecisionsView,
} from "../../lib/decisions/compute-decisions";
import {
  DECISIONS_RELATED_INCLUDE,
  classifyDecisionsShell,
  decisionsNextActions,
  decisionsRelatedLinks,
  decisionsShellCopy,
  formatDecisionsMetric,
  type DecisionsNextAction,
  type DecisionsShellKind,
} from "../../lib/decisions/decisions-related";
import type { DecisionCategory, DecisionStatus, ResolvedDecision } from "../../lib/decisions/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./decisions.css";

type LiveView = Extract<DecisionsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const STATUS_COLOR: Record<DecisionStatus, string> = {
  proposed: "#b26a00",
  accepted: "#1f7a3d",
  rejected: "#c02626",
  superseded: "#8a8f98",
};

function DecisionsRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = decisionsRelatedLinks(orgId, { include: [...DECISIONS_RELATED_INCLUDE] });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related decision-log-related" aria-label="Related decision tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function DecisionsNextActionsPanel({ actions }: { actions: DecisionsNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions decision-log-next-actions"
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

function DecisionsShell({
  title,
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
  embedded = false,
}: {
  title: string;
  description: string;
  orgId?: string | null;
  shell: DecisionsShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
  embedded?: boolean;
}) {
  const actions = decisionsNextActions({ orgId, shell });
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const aiHref = hubHref("/ai", "decisions", orgId);
  const Root = embedded ? "div" : "main";

  return (
    <Root className={`module-page decision-log-page soft-gate${embedded ? " is-embedded" : ""}`}>
      {embedded ? null : (
        <PageHeader
          breadcrumbs={
            <>
              <a href={aiHref}>AI</a>
              {" / Decision Log"}
            </>
          }
          title="Decision Log"
          description={description}
        >
          <DecisionsRelatedStrip orgId={orgId} />
        </PageHeader>
      )}
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No decisions yet"
                : shell === "loading"
                  ? undefined
                  : "Decision Log"
        }
        badgeTone={shell === "error" ? "demo" : "setup"}
        title={title}
        description={description}
        aria-busy={shell === "loading" || undefined}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={workspaceHref}>Choose your team</Button>
        ) : null}
      </EmptyState>
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <DecisionsNextActionsPanel actions={actions} />
    </Root>
  );
}

function isAiHubEmbed(): boolean {
  return typeof window !== "undefined" && window.location.pathname === "/ai";
}

export default function DecisionsClient() {
  const [view, setView] = useState<DecisionsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const loading = view == null && !fetchFailed;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/decisions${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as DecisionsView | { error?: string };
        if (!response.ok || !("status" in data)) {
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
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as DecisionsView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  const decisionCount = view?.status === "live" ? view.decisions.length : 0;
  const openCount = view?.status === "live" ? view.summary.open.length : 0;
  const shell = classifyDecisionsShell({
    loading,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    decisionCount,
  });
  const shellCopy = decisionsShellCopy(shell);
  const nextActions = decisionsNextActions({
    orgId,
    shell,
    decisionCount,
    openCount,
  });
  const aiHref = hubHref("/ai", "decisions", orgId);
  const relatedLinks = decisionsRelatedLinks(orgId, {
    include: [...DECISIONS_RELATED_INCLUDE],
  });
  const embedded = isAiHubEmbed();

  if (shell === "loading") {
    return (
      <DecisionsShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="loading"
        embedded={embedded}
      />
    );
  }

  if (shell === "error") {
    return (
      <DecisionsShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error}
        onRetry={() => load()}
        embedded={embedded}
      />
    );
  }

  if (shell === "setup" && view?.status === "setup_required") {
    return (
      <DecisionsShell
        title={view.message}
        description={shellCopy.description}
        orgId={view.orgId}
        shell="setup"
        embedded={embedded}
      >
        <ol className="strategy-setup-steps">
          {view.steps.map((step) => (
            <li key={step.id}>
              <div>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
              <a href={step.href.startsWith("/") ? withOrgHref(step.href, view.orgId) : step.href}>
                Open
              </a>
            </li>
          ))}
        </ol>
      </DecisionsShell>
    );
  }

  if (shell === "setup") {
    return (
      <DecisionsShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="setup"
        embedded={embedded}
      />
    );
  }

  if (view?.status !== "live") {
    return (
      <DecisionsShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="setup"
        embedded={embedded}
      />
    );
  }

  const Root = embedded ? "div" : "main";
  const headerActions = (
    <div className="decision-log-header-actions">
      {relatedLinks.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
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
    </div>
  );

  return (
    <Root className={`module-page decision-log-page${embedded ? " is-embedded" : ""}`}>
      {embedded ? (
        headerActions
      ) : (
        <PageHeader
          breadcrumbs={
            <>
              <a href={aiHref}>AI</a>
              {" / Decision Log"}
            </>
          }
          title="Decision Log"
          description="Record the calls that shape your season — context, options, what you chose, and why. Institutional memory for next year."
        >
          {headerActions}
        </PageHeader>
      )}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <DecisionsNextActionsPanel actions={nextActions} />

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No decisions yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href="#decision-log-form">
            Record first decision
          </Button>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} loaded />
        {view.summary.open.length > 0 ? <OpenDecisions view={view} /> : null}
        <AddDecisionForm busy={busy} mutate={mutate} />
        <DecisionList view={view} busy={busy} mutate={mutate} />
      </div>
    </Root>
  );
}

function SummaryTiles({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const s = view.summary;
  const tiles = [
    { label: "Decisions", value: formatDecisionsMetric(s.total, loaded) },
    { label: "Open (proposed)", value: formatDecisionsMetric(s.byStatus.proposed, loaded) },
    { label: "Accepted", value: formatDecisionsMetric(s.byStatus.accepted, loaded) },
    { label: "Superseded", value: formatDecisionsMetric(s.supersededCount, loaded) },
  ];
  return (
    <Panel className="decision-log-coverage" aria-label="Decision Log summary">
      <div className="decision-log-stats">
        <div>
          <span className={`app-badge ${s.total === 0 ? "setup" : "good"}`}>
            {s.total === 0 ? "EMPTY" : "LOGGED"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Season log</h2>
          <small className="app-muted">Real decision records only.</small>
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
      {s.byCategory.length > 0 ? (
        <div className="decision-log-category-row">
          {s.byCategory.map((row) => (
            <span key={row.category} className="app-badge setup">
              {decisionCategoryLabel(row.category)}: {row.count}
            </span>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function OpenDecisions({ view }: { view: LiveView }) {
  return (
    <Panel id="decision-log-open" className="decision-log-open" aria-label="Open proposals">
      <h2 style={{ marginTop: 0 }}>Awaiting a call</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Proposed only — accept, reject, or supersede with real rationale. Nothing is invented.
      </p>
      <ul>
        {view.summary.open.map((decision) => (
          <li key={decision.id}>
            <strong>{decision.title}</strong>
            <small className="app-muted"> · {decisionCategoryLabel(decision.category)}</small>
            {decision.options.length > 0 ? (
              <small className="app-muted"> · {decision.options.length} option(s) on the table</small>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AddDecisionForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({
      title: "",
      category: "design" as DecisionCategory,
      status: "proposed" as DecisionStatus,
      context: "",
      options: "",
      decision: "",
      rationale: "",
      deciders: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      id="decision-log-form"
      className="app-card soft-panel decision-log-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim()) return;
        mutate({
          action: "create-decision",
          title: form.title,
          category: form.category,
          status: form.status,
          context: form.context || undefined,
          options: form.options || undefined,
          decision: form.decision || undefined,
          rationale: form.rationale || undefined,
          deciders: form.deciders || undefined,
        });
        setForm(empty);
      }}
    >
      <h2 style={{ margin: 0 }}>Record a decision</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Paste real context and rationale only.
      </p>
      <FormGrid>
        <FormRow label="Decision" wide>
          <input
            value={form.title}
            onChange={set("title")}
            placeholder="Swerve vs. tank drivetrain"
            required
          />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {DECISION_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {decisionCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Status">
          <select value={form.status} onChange={set("status")}>
            {DECISION_STATUSES.filter((s) => s !== "superseded").map((status) => (
              <option key={status} value={status}>
                {decisionStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Deciders (optional)">
          <input
            value={form.deciders}
            onChange={set("deciders")}
            placeholder="Design team + lead mentor"
          />
        </FormRow>
        <FormRow label="Context — what problem / constraint?" wide>
          <textarea value={form.context} onChange={set("context")} rows={2} />
        </FormRow>
        <FormRow label="Options considered (one per line)" wide>
          <textarea
            value={form.options}
            onChange={set("options")}
            rows={2}
            placeholder={"Swerve\nWest-coast tank\nMecanum"}
          />
        </FormRow>
        <FormRow label="Decision (if made)">
          <textarea value={form.decision} onChange={set("decision")} rows={2} />
        </FormRow>
        <FormRow label="Rationale">
          <textarea value={form.rationale} onChange={set("rationale")} rows={2} />
        </FormRow>
      </FormGrid>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim()}>
          Record decision
        </Button>
      </div>
    </form>
  );
}

function DecisionList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  if (view.decisions.length === 0) {
    return null;
  }
  return (
    <section aria-label="Decision entries">
      <ul className="decision-log-list">
        {view.decisions.map((decision) => (
          <li key={decision.id}>
            <DecisionCard decision={decision} all={view.decisions} busy={busy} mutate={mutate} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DecisionCard({
  decision,
  all,
  busy,
  mutate,
}: {
  decision: ResolvedDecision;
  all: ResolvedDecision[];
  busy: boolean;
  mutate: Mutate;
}) {
  const color = STATUS_COLOR[decision.effectiveStatus];
  const supersedeOptions = all.filter((d) => d.id !== decision.id);
  const superseded = decision.effectiveStatus === "superseded";
  return (
    <article
      className={["app-card soft-panel decision-log-card", superseded ? "is-superseded" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="decision-log-card-head">
        <div>
          <div className="decision-log-card-meta">
            <span className="app-badge" style={{ background: color, color: "#fff" }}>
              {decisionStatusLabel(decision.effectiveStatus)}
            </span>
            <small className="app-muted">
              {decisionCategoryLabel(decision.category)}
              {decision.decidedOn ? ` · ${decision.decidedOn}` : ""}
              {decision.deciders ? ` · ${decision.deciders}` : ""}
            </small>
          </div>
          <h2>{decision.title}</h2>
        </div>
      </header>

      {decision.supersededByTitle ? (
        <p className="app-muted decision-log-field">
          ↳ Replaced by <strong>{decision.supersededByTitle}</strong>
        </p>
      ) : null}

      {decision.context ? (
        <p className="decision-log-field">
          <span className="app-muted">Context: </span>
          {decision.context}
        </p>
      ) : null}
      {decision.options.length > 0 ? (
        <div className="decision-log-field">
          <span className="app-muted">Options considered:</span>
          <ul className="decision-log-options">
            {decision.options.map((option) => (
              <li key={option}>{option}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {decision.decision ? (
        <p className="decision-log-field">
          <span className="app-muted">Decision: </span>
          <strong>{decision.decision}</strong>
        </p>
      ) : null}
      {decision.rationale ? (
        <p className="decision-log-field">
          <span className="app-muted">Why: </span>
          {decision.rationale}
        </p>
      ) : null}

      <footer className="decision-log-card-foot">
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Status
          <select
            value={decision.status}
            disabled={busy}
            onChange={(event) =>
              mutate({ action: "update-decision", decisionId: decision.id, status: event.target.value })
            }
          >
            {DECISION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {decisionStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Supersedes
          <select
            value={decision.supersedesId ?? ""}
            disabled={busy}
            onChange={(event) =>
              mutate({
                action: "update-decision",
                decisionId: decision.id,
                supersedesId: event.target.value,
              })
            }
          >
            <option value="">—</option>
            {supersedeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title.slice(0, 40)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${decision.title}"?`)) {
              mutate({ action: "delete-decision", decisionId: decision.id });
            }
          }}
          style={{ marginLeft: "auto" }}
        >
          Delete
        </button>
      </footer>
    </article>
  );
}
