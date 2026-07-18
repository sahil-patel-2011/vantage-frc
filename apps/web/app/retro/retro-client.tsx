"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { RETRO_ITEM_KINDS, retroItemKindLabel } from "../../lib/retro";
import type { RetroView } from "../../lib/retro/compute-retro";
import type { RetroActionStatus, RetroItemKind } from "../../lib/retro/types";

export type { RetroView };

const ACTION_STATUS_LABEL: Record<RetroActionStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
};

const KIND_TONE: Record<RetroItemKind, string> = {
  start: "good",
  stop: "demo",
  continue: "setup",
};

type LiveView = Extract<RetroView, { status: "live" }>;

export default function RetroClient() {
  const [view, setView] = useState<RetroView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((overrides?: { season?: number; sessionId?: string | null }) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = overrides?.season ?? (params.get("season") ? Number(params.get("season")) : null);
    const sessionQuery = overrides?.sessionId;
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    if (sessionQuery) query.set("sessionId", sessionQuery);
    void fetch(`/api/retro${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as RetroView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        if (data.status === "live") setSessionId(data.activeSession?.id ?? null);
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
        const response = await fetch("/api/retro", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, sessionId: sessionId ?? undefined, ...payload }),
        });
        const data = (await response.json()) as RetroView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        if (data.status === "live") setSessionId(data.activeSession?.id ?? null);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, sessionId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Retro"}
          </>
        }
        title="Team Retrospective"
        description="Structured start/stop/continue retros with voting and tracked action items — plus an auto-compiled season postmortem from your decisions, risks, incidents, and FMEA log."
      >
        {view?.status === "live" && view.sessions.length > 0 ? (
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
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState title="Could not load the retrospective" description="A network or server issue prevented loading. Try again.">
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
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
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <NewSessionForm busy={busy} mutate={mutate} />
          {view.activeSession ? (
            <>
              <ItemBoard view={view} busy={busy} mutate={mutate} />
              <ActionItems view={view} busy={busy} mutate={mutate} />
            </>
          ) : (
            <EmptyState
              badge="No session yet"
              badgeTone="setup"
              title="Start your first retro"
              description="Create a session above to begin collecting start/stop/continue feedback."
            />
          )}
          <Postmortems view={view} busy={busy} mutate={mutate} />
        </div>
      )}
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
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        mutate({ action: "create-session", title, periodLabel });
        setTitle("");
        setPeriodLabel("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>New retro session</h2>
      <FormGrid min={180}>
        <FormRow label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Week 3 build retro" required />
        </FormRow>
        <FormRow label="Period (optional)">
          <input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="Jan 12–18" />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !title.trim()}>
          Start session
        </button>
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
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}
    >
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
        <small className="app-muted">{items.length}</small>
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
        <button type="submit" className="app-button secondary" disabled={busy || !content.trim()}>
          Add
        </button>
      </form>
      {items.length === 0 ? (
        <p className="app-muted">No items yet.</p>
      ) : (
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {items.map((item) => (
            <li
              key={item.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
            >
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
    <Panel>
      <h2 style={{ marginTop: 0 }}>Action items</h2>
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
          <button type="submit" className="app-button secondary" disabled={busy || !title.trim()}>
            Add action item
          </button>
        </div>
      </form>
      {view.actionItems.length === 0 ? (
        <p className="app-muted">No action items yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {view.actionItems.map((item) => (
            <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
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
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Season postmortem</h2>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() => mutate({ action: "generate-postmortem" })}
        >
          Compile postmortem
        </button>
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
          No postmortem compiled yet for this season. It draws from your decisions, risks, incidents, and FMEA log —
          nothing is invented if those are empty.
        </p>
      )}
    </Panel>
  );
}
