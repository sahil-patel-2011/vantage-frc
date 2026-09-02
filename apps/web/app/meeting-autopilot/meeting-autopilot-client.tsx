"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { agendaItemKindLabel } from "../../lib/meeting-autopilot";
import type { MeetingAutopilotView } from "../../lib/meeting-autopilot/compute-meeting-autopilot";
import type { AgendaItem, MeetingAgenda } from "../../lib/meeting-autopilot/types";
import { renderReceiptFrom, type RenderReceipt } from "../../lib/ai-render/outcome";
import { RenderAttribution } from "../../components/ui/render-attribution";

type LiveView = Extract<MeetingAutopilotView, { status: "live" }>;

export default function MeetingAutopilotClient() {
  const [view, setView] = useState<MeetingAutopilotView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [renderReceipt, setRenderReceipt] = useState<RenderReceipt | null>(null);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/meeting-autopilot${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MeetingAutopilotView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
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

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/meeting-autopilot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as MeetingAutopilotView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        const receipt = renderReceiptFrom(data);
        if (receipt) setRenderReceipt(receipt);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Meeting Autopilot"}
          </>
        }
        title="Meeting-agenda autopilot"
        description="Builds a meeting agenda from open blockers, overdue tasks, unresolved decisions, and open FMEA — then drafts minutes into action items."
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

      <RenderAttribution receipt={renderReceipt} feature="meeting_autopilot" />

      {fetchFailed ? (
        (() => {
          const kind = classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          });
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
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
          <LiveAgendaPreview view={view} busy={busy} mutate={mutate} />
          <AgendasPanel view={view} busy={busy} mutate={mutate} />
          <ActionItemsPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function agendaItemKey(item: AgendaItem): string {
  return `${item.kind}:${item.sourceId}`;
}

function LiveAgendaPreview({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState("Weekly build sync");
  const [meetingOn, setMeetingOn] = useState("");

  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Current agenda preview</h2>
          <small className="app-muted">
            {view.sourceCounts.blockers} blocker(s) · {view.sourceCounts.overdueTasks} overdue task(s) ·{" "}
            {view.sourceCounts.decisions} unresolved decision(s) · {view.sourceCounts.fmea} open FMEA
          </small>
        </div>
      </header>

      {view.liveAgendaItems.length === 0 ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          No open blockers, overdue tasks, unresolved decisions, or open FMEA right now — nothing to put on the agenda.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 8 }}>
          {view.liveAgendaItems.map((item) => (
            <li key={agendaItemKey(item)} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className="app-badge demo">{agendaItemKindLabel(item.kind)}</span>{" "}
                <strong>{item.title}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {item.detail}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          mutate({ action: "generate-agenda", title, meetingOn: meetingOn || undefined });
        }}
        style={{ display: "grid", gap: 10, marginTop: 16 }}
      >
        <FormGrid min={160}>
          <FormRow label="Meeting title">
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </FormRow>
          <FormRow label="Meeting date (optional)">
            <input type="date" value={meetingOn} onChange={(event) => setMeetingOn(event.target.value)} />
          </FormRow>
        </FormGrid>
        <div>
          <button type="submit" className="app-button" disabled={busy || !title.trim()}>
            Generate agenda
          </button>
        </div>
      </form>
    </Panel>
  );
}

function AgendasPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [minutesByAgenda, setMinutesByAgenda] = useState<Record<string, string>>({});

  if (view.agendas.length === 0) {
    return (
      <EmptyState
        badge="No agendas yet"
        badgeTone="setup"
        title="Generate your first agenda"
        description="Use the preview above to snapshot the current blockers, overdue tasks, decisions, and FMEA into a meeting agenda."
      />
    );
  }

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Meeting agendas</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14 }}>
        {view.agendas.map((agenda: MeetingAgenda) => (
          <li key={agenda.id} className="app-card soft-panel" style={{ display: "grid", gap: 8, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <strong>{agenda.title}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {agenda.meetingOn ? `${agenda.meetingOn} · ` : ""}
                  {agenda.sourceCounts.blockers + agenda.sourceCounts.overdueTasks + agenda.sourceCounts.decisions + agenda.sourceCounts.fmea} item(s) ·{" "}
                  <span className={`app-badge ${agenda.status === "finalized" ? "good" : "setup"}`}>{agenda.status}</span>
                </small>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {agenda.status === "draft" ? (
                  <button
                    type="button"
                    className="app-button secondary"
                    disabled={busy}
                    onClick={() => mutate({ action: "update-agenda-status", agendaId: agenda.id, status: "finalized" })}
                  >
                    Finalize
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete agenda "${agenda.title}"?`)) {
                      mutate({ action: "delete-agenda", agendaId: agenda.id });
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>

            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
              {agenda.agendaItems.map((item) => (
                <li key={agendaItemKey(item)}>
                  <small className="app-muted">
                    <span className="app-badge demo">{agendaItemKindLabel(item.kind)}</span> {item.title}
                  </small>
                </li>
              ))}
            </ul>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const minutesText = minutesByAgenda[agenda.id]?.trim();
                if (!minutesText) return;
                mutate({ action: "draft-minutes", agendaId: agenda.id, minutesText });
                setMinutesByAgenda((prev) => ({ ...prev, [agenda.id]: "" }));
              }}
              style={{ display: "grid", gap: 6, marginTop: 6 }}
            >
              <FormRow label="Paste post-meeting minutes to draft action items">
                <textarea
                  rows={3}
                  placeholder={"- Order replacement belt @Alex due 2026-07-25\nTODO: Finish wiring diagram review"}
                  value={minutesByAgenda[agenda.id] ?? ""}
                  onChange={(event) =>
                    setMinutesByAgenda((prev) => ({ ...prev, [agenda.id]: event.target.value }))
                  }
                />
              </FormRow>
              <div>
                <button
                  type="submit"
                  className="app-button secondary"
                  disabled={busy || !(minutesByAgenda[agenda.id] ?? "").trim()}
                >
                  Draft action items
                </button>
              </div>
            </form>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ActionItemsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.actionItems.length === 0) {
    return (
      <EmptyState
        title="No action items yet"
        description="Draft minutes on an agenda above to extract action items automatically."
      />
    );
  }

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Action items</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.actionItems.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong style={{ textDecoration: item.status === "done" ? "line-through" : "none" }}>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.owner ? `${item.owner} · ` : ""}
                {item.dueOn ? `due ${item.dueOn} · ` : ""}
                <span className={`app-badge ${item.status === "done" ? "good" : "setup"}`}>{item.status}</span>
              </small>
              {item.sourceExcerpt ? <small className="app-muted">“{item.sourceExcerpt}”</small> : null}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() =>
                  mutate({
                    action: "update-action-item",
                    actionItemId: item.id,
                    status: item.status === "done" ? "open" : "done",
                  })
                }
              >
                {item.status === "done" ? "Reopen" : "Mark done"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${item.title}"?`)) {
                    mutate({ action: "delete-action-item", actionItemId: item.id });
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
