"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { RETRO_ITEM_KINDS, retroItemKindLabel } from "../../lib/retro";
import type { RetroView } from "../../lib/retro/compute-retro";
import {
  RETRO_HANDOFF_INCLUDE,
  RETRO_RELATED_INCLUDE,
  classifyRetroShell,
  formatRetroMetric,
  retroNextActions,
  retroRelatedLinks,
  retroSetupSteps,
  retroShellCopy,
  shouldShowRetroSummaryTiles,
  type RetroNextAction,
  type RetroShellKind,
} from "../../lib/retro/retro-related";
import type { RetroActionStatus, RetroHandoffTarget, RetroItemKind } from "../../lib/retro/types";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./retro.css";

export type { RetroView };

const ACTION_STATUS_LABEL: Record<RetroActionStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
};

const KIND_TONE: Record<RetroItemKind, string> = {
  start: "good",
  stop: "danger",
  continue: "setup",
};

type LiveView = Extract<RetroView, { status: "live" }>;

function isRetroView(value: unknown): value is RetroView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function retroCacheOrg(data: RetroView, orgHint: string): string {
  if ("orgId" in data && typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistRetroSnapshot(orgHint: string, seasonHint: string, data: RetroView): Promise<void> {
  const cacheOrg = retroCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("retro", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("retro", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Retro already painted; IndexedDB is best-effort.
  }
}

function RetroRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = retroRelatedLinks(orgId, {
    include: [...RETRO_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related retro-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function RetroNextActionsPanel({ actions }: { actions: RetroNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions retro-next-actions" aria-label="Next actions">
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

function RetroShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: RetroShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = retroNextActions({ orgId, shell });
  const copy = retroShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "retro", orgId);
  const setup = shell === "setup" ? retroSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page retro-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Retro"}
          </>
        }
        title="Team Retrospective"
        description={description}
      >
        <RetroRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No session yet"
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
        {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href="#retro-new-session">Start a session</Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <RetroNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function RetroClient() {
  const [view, setView] = useState<RetroView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<RetroView | null>(null);
  viewRef.current = view;

  const load = useCallback((overrides?: { season?: number; sessionId?: string | null }) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seasonQuery =
        overrides?.season ?? (params.get("season") ? Number(params.get("season")) : null);
      const seasonHint =
        seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : "";
      const sessionQuery = overrides?.sessionId;
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<RetroView>("retro", urlOrg || "_", seasonHint);
        if (!viewRef.current && cached?.data && isRetroView(cached.data)) {
          setView(cached.data);
          setSeason(cached.data.seasonYear);
          if (cached.data.status === "live") setSessionId(cached.data.activeSession?.id ?? null);
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
      if (sessionQuery) query.set("sessionId", sessionQuery);
      try {
        const response = await fetch(`/api/retro${query.toString() ? `?${query.toString()}` : ""}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as RetroView | { error?: string };
        if (!response.ok || !isRetroView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Retro. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        if (data.status === "live") setSessionId(data.activeSession?.id ?? null);
        setFromCache(false);
        setCachedAt(null);
        await persistRetroSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Retro. Showing the last copy on this device.");
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
  const itemCount =
    view?.status === "live"
      ? RETRO_ITEM_KINDS.reduce((sum, kind) => sum + view.itemsByKind[kind].length, 0)
      : 0;
  const openActionCount =
    view?.status === "live" ? view.actionItems.filter((a) => a.status !== "done").length : 0;

  const shell = classifyRetroShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    sessionCount,
  });
  const shellCopy = retroShellCopy(shell);
  const learnedItemCount = view?.status === "live" ? view.learnedItems.length : 0;
  const nextActions = retroNextActions({
    orgId,
    shell,
    sessionCount,
    openActionCount,
    learnedItemCount,
  });
  const relatedLinks = retroRelatedLinks(orgId, {
    include: [...RETRO_RELATED_INCLUDE],
  });
  const teamHref = hubWorkbenchHref("team", "retro", orgId);
  const showTiles = shouldShowRetroSummaryTiles({
    sessionCount,
    itemCount,
    openActionCount,
  });

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/retro", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId,
            seasonYear: season ?? undefined,
            sessionId: sessionId ?? undefined,
            ...payload,
          }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as RetroView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        if (data.status === "live") setSessionId(data.activeSession?.id ?? null);
        void persistRetroSnapshot(orgId, season != null ? String(season) : "", data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, sessionId, busy],
  );

  if (shell === "loading") {
    return (
      <RetroShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Retro" fromCache={fromCache} cachedAt={cachedAt} />
      </RetroShell>
    );
  }

  if (shell === "error") {
    return (
      <RetroShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Retro" fromCache={fromCache} cachedAt={cachedAt} />
      </RetroShell>
    );
  }

  if (shell === "setup") {
    return (
      <RetroShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Retro" fromCache={fromCache} cachedAt={cachedAt} />
      </RetroShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <RetroShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Retro" fromCache={fromCache} cachedAt={cachedAt} />
      </RetroShell>
    );
  }

  return (
    <main className="module-page retro-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Retro"}
          </>
        }
        title="Team Retrospective"
        description="Structured start/stop/continue retros with voting and tracked action items — plus an auto-compiled season postmortem from your decisions, risks, incidents, and FMEA log. Cross-check Messages, FMEA, and Decisions."
      >
        <div className="retro-header-actions">
          {view.sessions.length > 0 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Session
              <select
                value={sessionId ?? view.activeSession?.id ?? ""}
                onChange={(event) => {
                  const next = event.target.value;
                  setSessionId(next);
                  load({ sessionId: next });
                }}
              >
                {view.sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.status})
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

      <OfflineBanner feature="Retro" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <RetroNextActionsPanel actions={nextActions} />

      {showTiles ? (
        <Panel className="retro-panel" aria-label="Retro session counts">
          <div className="retro-board" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
            <div>
              <strong>{formatRetroMetric(sessionCount, true)}</strong>
              <span className="app-muted">Sessions</span>
            </div>
            <div>
              <strong>{formatRetroMetric(itemCount, true)}</strong>
              <span className="app-muted">Items</span>
            </div>
            <div>
              <strong>{formatRetroMetric(openActionCount, true)}</strong>
              <span className="app-muted">Open actions</span>
            </div>
            <div>
              <strong>{formatRetroMetric(view.postmortems.length, true)}</strong>
              <span className="app-muted">Postmortems</span>
            </div>
          </div>
        </Panel>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No session yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
          className="product-hub-setup"
        >
          <Button as="a" variant="primary" href="#retro-new-session">
            Start a session
          </Button>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <NewSessionForm busy={busy} mutate={mutate} />
        {view.activeSession ? (
          <>
            <ItemBoard view={view} busy={busy} mutate={mutate} />
            <ActionItems view={view} busy={busy} mutate={mutate} />
          </>
        ) : shell !== "empty" ? (
          <EmptyState
            soft
            badge="No active session"
            badgeTone="setup"
            title="Start a retro session"
            description="Create a session above to begin collecting start/stop/continue feedback."
          />
        ) : null}
        <LearnedItems view={view} busy={busy} mutate={mutate} />
        <Postmortems view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function NewSessionForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  return (
    <Panel
      as="form"
      id="retro-new-session"
      className="retro-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        mutate({ action: "create-session", title, periodLabel });
        setTitle("");
        setPeriodLabel("");
      }}
    >
      <h2 style={{ margin: 0 }}>New retro session</h2>
      <p className="app-muted">Sessions start empty.</p>
      <FormGrid min={180}>
        <FormRow label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Week 3 build retro" required />
        </FormRow>
        <FormRow label="Period (optional)">
          <input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="Jan 12–18" />
        </FormRow>
      </FormGrid>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !title.trim()}>
          Start session
        </Button>
      </div>
    </Panel>
  );
}

function ItemBoard({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <section className="app-card soft-panel retro-board" aria-label="Start stop continue board">
      {RETRO_ITEM_KINDS.map((kind) => (
        <ItemColumn key={kind} kind={kind} view={view} busy={busy} mutate={mutate} />
      ))}
    </section>
  );
}

function ItemColumn({
  kind,
  view,
  busy,
  mutate,
}: {
  kind: RetroItemKind;
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [content, setContent] = useState("");
  const items = view.itemsByKind[kind];
  return (
    <div>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className={`app-badge ${KIND_TONE[kind]}`}>{retroItemKindLabel(kind)}</span>
        <small className="app-muted">{formatRetroMetric(items.length, true)}</small>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!content.trim()) return;
          mutate({ action: "add-item", kind, content });
          setContent("");
        }}
        style={{ display: "flex", gap: 6, marginBottom: 10 }}
      >
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={`Add a ${retroItemKindLabel(kind).toLowerCase()} item`}
          style={{ flex: 1 }}
        />
        <Button variant="secondary" type="submit" disabled={busy || !content.trim()}>
          Add
        </Button>
      </form>
      {items.length === 0 ? (
        <p className="app-muted">No items yet.</p>
      ) : (
        <ul className="retro-list">
          {items.map((item) => (
            <li key={item.id} className="retro-row">
              <div>
                <span>{item.content}</span>
                <small className="app-muted" style={{ display: "block" }}>
                  {item.authorName ?? "Unknown"}
                </small>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "toggle-vote", itemId: item.id })}
                >
                  {item.votedByMe ? "★" : "☆"} {item.voteCount}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "delete-item", itemId: item.id })}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionItems({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [dueOn, setDueOn] = useState("");
  return (
    <Panel className="retro-panel" id="retro-actions">
      <h2 style={{ marginTop: 0 }}>Action items</h2>
      <p className="app-muted">Tracked from real retro sessions only.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          mutate({ action: "add-action", title, owner: owner || undefined, dueOn: dueOn || undefined });
          setTitle("");
          setOwner("");
          setDueOn("");
        }}
        style={{ display: "grid", gap: 10, marginBottom: 12 }}
      >
        <FormGrid min={160}>
          <FormRow label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fix intake belt slip" required />
          </FormRow>
          <FormRow label="Owner (optional)">
            <input value={owner} onChange={(e) => setOwner(e.target.value)} />
          </FormRow>
          <FormRow label="Due (optional)">
            <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </FormRow>
        </FormGrid>
        <div>
          <Button variant="secondary" type="submit" disabled={busy || !title.trim()}>
            Add action item
          </Button>
        </div>
      </form>
      {view.actionItems.length === 0 ? (
        <p className="app-muted">No action items yet.</p>
      ) : (
        <ul className="retro-list">
          {view.actionItems.map((item) => (
            <li key={item.id} className="retro-row">
              <div>
                <strong>{item.title}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {item.owner ? `${item.owner} · ` : ""}
                  {item.dueOn ? `due ${item.dueOn}` : "no due date"}
                </small>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select
                  value={item.status}
                  disabled={busy}
                  onChange={(event) =>
                    mutate({ action: "update-action-status", actionId: item.id, status: event.target.value })
                  }
                >
                  <option value="open">{ACTION_STATUS_LABEL.open}</option>
                  <option value="in_progress">{ACTION_STATUS_LABEL.in_progress}</option>
                  <option value="done">{ACTION_STATUS_LABEL.done}</option>
                </select>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "delete-action", actionId: item.id })}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function LearnedItems({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const items = view.learnedItems;
  const handoffLinks = retroRelatedLinks(view.orgId, { include: [...RETRO_HANDOFF_INCLUDE] });
  const send = (target: RetroHandoffTarget) => mutate({ action: "handoff-lessons", target });

  return (
    <Panel className="retro-panel" id="retro-learned">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Learned items</h2>
          <p className="app-muted">
            The start / stop / continue notes your team wrote.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {handoffLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </header>
      {view.lastHandoff ? (
        <p className="telemetry-status" role="status">
          {view.lastHandoff.message}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="app-muted">
          No learned items yet. Write a start / stop / continue note above and it will carry into the Season
          report and the Playbook.
        </p>
      ) : (
        <ul className="retro-list">
          {items.map((item) => (
            <li key={item.id} className="retro-row">
              <div>
                <span className={`app-badge ${KIND_TONE[item.kind]}`}>{retroItemKindLabel(item.kind)}</span>{" "}
                <span>{item.content}</span>
                <small className="app-muted" style={{ display: "block" }}>
                  {item.sessionTitle || "Untitled session"}
                  {item.authorName ? ` · ${item.authorName}` : ""}
                  {item.voteCount > 0 ? ` · ${item.voteCount} vote${item.voteCount === 1 ? "" : "s"}` : ""}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" type="button" disabled={busy || items.length === 0} onClick={() => send("season-report")}>
          Send to Season report
        </Button>
        <Button variant="secondary" type="button" disabled={busy || items.length === 0} onClick={() => send("playbook")}>
          Send to Playbook
        </Button>
        <Button variant="secondary" type="button" disabled={busy || items.length === 0} onClick={() => send("both")}>
          Send to both
        </Button>
        {view.handoff.playbookHref ? (
          <Button as="a" variant="secondary" href={view.handoff.playbookHref}>
            Open playbook page
          </Button>
        ) : null}
        {view.handoff.seasonReportCount > 0 ? (
          <Button as="a" variant="secondary" href={withOrgHref("/season-report", view.orgId)}>
            {formatRetroMetric(view.handoff.seasonReportCount, true)} in Season report
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

function Postmortems({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const latest = useMemo(() => view.postmortems[0] ?? null, [view.postmortems]);
  return (
    <Panel className="retro-panel">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Season postmortem</h2>
        <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "generate-postmortem" })}>
          Compile postmortem
        </Button>
      </header>
      {latest ? (
        <div style={{ marginTop: 12 }}>
          <p>{latest.narrative}</p>
          <small className="app-muted">
            Generated {new Date(latest.createdAt).toLocaleString()}
            {latest.generatedByName ? ` by ${latest.generatedByName}` : ""}
          </small>
        </div>
      ) : (
        <p className="app-muted" style={{ marginTop: 12 }}>
          No postmortem compiled yet for this season. It draws from your decisions, risks, incidents, and FMEA log.
        </p>
      )}
    </Panel>
  );
}
