"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormRow, PageHeader, Panel } from "../../components/ui";
import { agendaItemKindLabel } from "../../lib/meeting-autopilot";
import type { MeetingAutopilotView } from "../../lib/meeting-autopilot/compute-meeting-autopilot";
import type { AgendaItem, CalendarMeeting, MeetingAgenda } from "../../lib/meeting-autopilot/types";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<MeetingAutopilotView, { status: "live" }>;

export default function MeetingAutopilotClient() {
  const [view, setView] = useState<MeetingAutopilotView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
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
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const seasons = view && "seasons" in view ? view.seasons : [];

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
        description="Agenda and minutes persist against a calendar meeting. The page stays empty until a meeting exists — never DEMO notes."
      >
        {seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view?.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load(next);
              }}
            >
              {seasons.map((year) => (
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

      {fetchFailed ? (
        (() => {
          const kind = classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
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
      ) : view.status === "setup_required" || view.status === "empty" ? (
        <SetupOrEmpty view={view} />
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SuggestedAgenda view={view} />
          <MeetingsPanel view={view} busy={busy} mutate={mutate} />
          <ActionItemsPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SetupOrEmpty({ view }: { view: Extract<MeetingAutopilotView, { status: "setup_required" | "empty" }> }) {
  return (
    <EmptyState
      badge={view.status === "empty" ? "No meetings yet" : "Setup required"}
      badgeTone="setup"
      title={view.message}
      description={
        view.status === "empty"
          ? "Add a meeting on the team calendar. Agenda snapshots and minutes attach to that event."
          : undefined
      }
    >
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
  );
}

function agendaItemKey(item: AgendaItem): string {
  return `${item.kind}:${item.sourceId}`;
}

function SuggestedAgenda({ view }: { view: LiveView }) {
  return (
    <Panel>
      <header>
        <h2 style={{ margin: 0 }}>Suggested agenda items</h2>
        <small className="app-muted">
          {view.sourceCounts.blockers} blocker(s) · {view.sourceCounts.overdueTasks} overdue task(s) ·{" "}
          {view.sourceCounts.decisions} unresolved decision(s) · {view.sourceCounts.fmea} open FMEA — snapshot these onto
          a calendar meeting below.
        </small>
      </header>
      {view.liveAgendaItems.length === 0 ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          No open blockers, overdue tasks, unresolved decisions, or open FMEA right now — nothing extra to put on the
          agenda.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 8 }}>
          {view.liveAgendaItems.map((item) => (
            <li key={agendaItemKey(item)}>
              <span className="app-badge setup">{agendaItemKindLabel(item.kind)}</span>{" "}
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.detail}
              </small>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MeetingsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [minutesByEvent, setMinutesByEvent] = useState<Record<string, string>>({});

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Calendar meetings</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14 }}>
        {view.meetings.map((meeting) => (
          <MeetingCard
            key={meeting.id}
            meeting={meeting}
            busy={busy}
            minutes={minutesByEvent[meeting.id] ?? meeting.minutesText ?? ""}
            onMinutesChange={(value) => setMinutesByEvent((prev) => ({ ...prev, [meeting.id]: value }))}
            mutate={mutate}
          />
        ))}
      </ul>
    </Panel>
  );
}

function MeetingCard({
  meeting,
  busy,
  minutes,
  onMinutesChange,
  mutate,
}: {
  meeting: CalendarMeeting;
  busy: boolean;
  minutes: string;
  onMinutesChange: (value: string) => void;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const agenda: MeetingAgenda | null = meeting.agenda;
  const persistedMinutes = meeting.minutesText ?? "";

  return (
    <li className="app-card soft-panel" style={{ display: "grid", gap: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <strong>{meeting.title}</strong>
          <small className="app-muted" style={{ display: "block" }}>
            {meeting.meetingOn || meeting.startsAt.slice(0, 10)}
            {meeting.location ? ` · ${meeting.location}` : ""}
            {agenda
              ? ` · ${agenda.sourceCounts.blockers + agenda.sourceCounts.overdueTasks + agenda.sourceCounts.decisions + agenda.sourceCounts.fmea} item(s)`
              : " · no agenda snapshot yet"}
            {agenda ? (
              <>
                {" · "}
                <span className={`app-badge ${agenda.status === "finalized" ? "good" : "setup"}`}>{agenda.status}</span>
              </>
            ) : null}
          </small>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="app-button"
            disabled={busy}
            onClick={() => mutate({ action: "generate-agenda", calendarEventId: meeting.id })}
          >
            {agenda ? "Refresh agenda" : "Generate agenda"}
          </button>
          {agenda?.status === "draft" ? (
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => mutate({ action: "update-agenda-status", agendaId: agenda.id, status: "finalized" })}
            >
              Finalize
            </button>
          ) : null}
          {agenda ? (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete agenda for "${meeting.title}"?`)) {
                  mutate({ action: "delete-agenda", agendaId: agenda.id });
                }
              }}
            >
              Delete agenda
            </button>
          ) : null}
        </div>
      </div>

      {agenda && agenda.agendaItems.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
          {agenda.agendaItems.map((item) => (
            <li key={agendaItemKey(item)}>
              <small className="app-muted">
                <span className="app-badge setup">{agendaItemKindLabel(item.kind)}</span> {item.title}
              </small>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const minutesText = minutes.trim();
          if (!minutesText) return;
          mutate({
            action: "draft-minutes",
            calendarEventId: meeting.id,
            agendaId: agenda?.id,
            minutesText,
          });
        }}
        style={{ display: "grid", gap: 6, marginTop: 6 }}
      >
        <FormRow label="Meeting minutes">
          <textarea
            rows={4}
            placeholder="Paste the real minutes. Bulleted, TODO:, or Action: lines become action items. Other lines stay as minutes."
            value={minutes}
            onChange={(event) => onMinutesChange(event.target.value)}
          />
        </FormRow>
        {persistedMinutes ? (
          <small className="app-muted">Saved minutes are stored on this calendar event.</small>
        ) : (
          <small className="app-muted">Minutes stay empty until you write them — nothing is invented.</small>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="app-button secondary"
            disabled={busy || !minutes.trim()}
            onClick={() =>
              mutate({
                action: "save-minutes",
                calendarEventId: meeting.id,
                agendaId: agenda?.id,
                minutesText: minutes.trim(),
              })
            }
          >
            Save minutes
          </button>
          <button type="submit" className="app-button secondary" disabled={busy || !minutes.trim()}>
            Save and draft action items
          </button>
        </div>
      </form>
    </li>
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
        description="Save minutes on a calendar meeting above. Only bulleted / TODO / Action lines become action items."
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
