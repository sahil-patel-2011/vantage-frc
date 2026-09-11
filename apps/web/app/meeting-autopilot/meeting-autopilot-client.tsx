"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { agendaItemKindLabel } from "../../lib/meeting-autopilot";
import type { MeetingAutopilotView } from "../../lib/meeting-autopilot/compute-meeting-autopilot";
import type { AgendaItem, CalendarMeeting, MeetingAgenda } from "../../lib/meeting-autopilot/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<MeetingAutopilotView, { status: "live" }>;

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function isMeetingAutopilotView(value: unknown): value is MeetingAutopilotView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "empty" || status === "live";
}

function meetingAutopilotCacheOrg(data: MeetingAutopilotView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "empty":
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistMeetingAutopilotSnapshot(
  orgHint: string,
  seasonHint: string,
  data: MeetingAutopilotView,
): Promise<void> {
  const cacheOrg = meetingAutopilotCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("meeting-autopilot", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("meeting-autopilot", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Meeting agenda already painted; IndexedDB is best-effort.
  }
}

function MeetingAutopilotRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related team tools">
      <Button as="a" variant="secondary" href={hubHref("/team", "calendar", orgId)}>
        Calendar
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "standup-digest", orgId)}>
        Standup
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "goals-tracker", orgId)}>
        Season Goals
      </Button>
    </nav>
  );
}

function MeetingAutopilotNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "calendar",
      label: "Open Calendar",
      detail: "Agenda and minutes attach to a meeting that already exists.",
      href: hubHref("/team", "calendar", orgId),
      primary: true,
    },
    {
      id: "standup",
      label: "Open Standup",
      detail: "Yesterday's hours and task movement feed the morning digest.",
      href: hubHref("/team", "standup-digest", orgId),
      primary: false,
    },
    {
      id: "goals",
      label: "Open Season Goals",
      detail: "Season targets sit beside this meeting board.",
      href: hubHref("/team", "goals-tracker", orgId),
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

export default function MeetingAutopilotClient() {
  const [view, setView] = useState<MeetingAutopilotView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<MeetingAutopilotView | null>(null);
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
      const cached = await getFeatureSnapshot<MeetingAutopilotView>(
        "meeting-autopilot",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isMeetingAutopilotView(cached.data)) {
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
    setErrorStatus(null);
    setLoadError("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(
        `/api/meeting-autopilot${query.toString() ? `?${query.toString()}` : ""}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      if (!response.ok || !isMeetingAutopilotView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Meeting agenda. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistMeetingAutopilotSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Meeting agenda. Showing the last copy on this device.");
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
        const response = await fetch("/api/meeting-autopilot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isMeetingAutopilotView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistMeetingAutopilotSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const seasons = view && "seasons" in view ? view.seasons : [];
  const teamHref = orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={teamHref}>Team</a>
          {" / Meeting-agenda autopilot"}
        </>
      }
      title="Meeting-agenda autopilot"
      description="Agenda and minutes persist against a calendar meeting. The page stays empty until a meeting exists."
    >
      {seasons.length > 0 ? (
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Season
          <select
            value={season ?? view?.seasonYear}
            onChange={(event) => {
              const next = Number(event.target.value);
              setSeason(next);
              void load(next);
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
      <MeetingAutopilotRelated orgId={orgId} />
    </PageHeader>
  );

  if (!view) {
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
        {header}
        <OfflineBanner feature="Meeting-agenda autopilot" fromCache={fromCache} cachedAt={cachedAt} />
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
    case "empty":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Meeting-agenda autopilot" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <SetupOrEmpty view={view} />
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
      <OfflineBanner feature="Meeting-agenda autopilot" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <MeetingAutopilotNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <SuggestedAgenda view={view} />
        <MeetingsPanel view={view} busy={busy} mutate={mutate} />
        <ActionItemsPanel view={view} busy={busy} mutate={mutate} />
      </div>
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
      {view.steps[0] ? (
        <Button as="a" variant="primary" href={view.steps[0].href}>
          {view.steps[0].label}
        </Button>
      ) : null}
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
          <Button variant="primary" type="button" disabled={busy} onClick={() => mutate({ action: "generate-agenda", calendarEventId: meeting.id })}>
            {agenda ? "Refresh agenda" : "Generate agenda"}
          </Button>
          {agenda?.status === "draft" ? (
            <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "update-agenda-status", agendaId: agenda.id, status: "finalized" })}>
              Finalize
            </Button>
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
          <small className="app-muted">Minutes stay empty until you write them.</small>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="secondary" type="button" disabled={busy || !minutes.trim()} onClick={() => mutate({ action: "save-minutes", calendarEventId: meeting.id, agendaId: agenda?.id, minutesText: minutes.trim(), }) }>
            Save minutes
          </Button>
          <Button variant="secondary" type="submit" disabled={busy || !minutes.trim()}>
            Save and draft action items
          </Button>
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
              <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "update-action-item", actionItemId: item.id, status: item.status === "done" ? "open" : "done", }) }>
                {item.status === "done" ? "Reopen" : "Mark done"}
              </Button>
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
