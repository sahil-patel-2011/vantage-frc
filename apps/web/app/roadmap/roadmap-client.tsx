"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { EmptyState, PageHeader, Panel, ProgressMeter, Button } from "../../components/ui";
import type { RoadmapView } from "../../lib/roadmap/load-roadmap";
import {
  URGENCY_LABELS,
  URGENCY_TONES,
  countdownLabel,
  formatDateRange,
  formatIsoDate,
  ownerLabel,
  summaryLine,
  toneColor,
} from "../../lib/roadmap/roadmap-presentation";
import type {
  RoadmapPhaseView,
  RoadmapTaskView,
  SeasonRoadmapView,
  TaskStatus,
} from "../../lib/roadmap/season-roadmap";
import { RESOURCE_FRESHNESS_NOTE, resourcesFor } from "../../lib/ui/curated-resources";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<RoadmapView, { status: "live" }>;

/** >=44px targets everywhere: a lead mentor works this list on a phone, standing up. */
const TAP: CSSProperties = { minHeight: 44, padding: "10px 14px" };

export default function RoadmapClient() {
  const [view, setView] = useState<RoadmapView | null>(null);
  const [kickoffInput, setKickoffInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadErrorMessage, setLoadErrorMessage] = useState("");
  const [openPhases, setOpenPhases] = useState<Record<string, boolean>>({});

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    setErrorStatus(null);
    setLoadErrorMessage("");
    const urlOrg = new URLSearchParams(window.location.search).get("orgId");
    void fetch(`/api/roadmap${urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as RoadmapView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setLoadErrorMessage("error" in data && data.error ? data.error : "");
          setErrorStatus(response.status);
          setFetchFailed(true);
          return;
        }
        setView(data);
        if (data.status === "live") setKickoffInput(data.roadmap.kickoffDate ?? "");
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      if (!orgId) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/roadmap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, orgId }),
        });
        const data = (await response.json()) as RoadmapView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Could not save. Try again.");
          return;
        }
        setView(data);
        if (data.status === "live") setKickoffInput(data.roadmap.kickoffDate ?? "");
      } catch {
        setError("Could not reach the server. Your change was not saved.");
      } finally {
        setBusy(false);
      }
    },
    [orgId],
  );

  const live = view && view.status === "live" ? view : null;

  const saveKickoff = useCallback(() => {
    if (!live) return;
    void post({
      action: "set-kickoff",
      kickoffDate: kickoffInput,
      rookieOnly: live.roadmap.rookieOnly,
    });
  }, [kickoffInput, live, post]);

  const clearKickoff = useCallback(() => {
    if (!live) return;
    setKickoffInput("");
    void post({ action: "set-kickoff", kickoffDate: "", rookieOnly: live.roadmap.rookieOnly });
  }, [live, post]);

  const toggleRookie = useCallback(() => {
    if (!live) return;
    void post({ action: "set-rookie-filter", rookieOnly: !live.roadmap.rookieOnly });
  }, [live, post]);

  const setTask = useCallback(
    (taskId: string, status: TaskStatus) => {
      if (!live) return;
      void post({ action: "set-task", taskId, status, rookieOnly: live.roadmap.rookieOnly });
    },
    [live, post],
  );

  const togglePhase = useCallback((phaseId: string) => {
    setOpenPhases((prev) => ({ ...prev, [phaseId]: !prev[phaseId] }));
  }, []);

  const failure = fetchFailed
    ? loadFailureCopy(
        classifyLoadFailure({
          status: errorStatus,
          message: loadErrorMessage,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
        }),
        {
          nextPath:
            typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
          message: loadErrorMessage || "A network or server issue prevented loading. Try again.",
        },
      )
    : null;

  const teamHref = orgId ? `/team?tab=knowledge&orgId=${encodeURIComponent(orgId)}` : "/team?tab=knowledge";

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Season roadmap"}
          </>
        }
        title="Season roadmap"
        description="Kickoff to first event, in the order it actually has to happen. Every date is calculated from the kickoff date you enter."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState title={failure.title} description={failure.description}>
          {failure.primary ? (
            <Button as="a" variant="primary" style={TAP} href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" style={TAP} onClick={() => load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your team." aria-busy />
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
        <>
          <KickoffPanel
            live={view}
            value={kickoffInput}
            onChange={setKickoffInput}
            onSave={saveKickoff}
            onClear={clearKickoff}
            onToggleRookie={toggleRookie}
            busy={busy}
          />
          <DueNextPanel roadmap={view.roadmap} onSetTask={setTask} busy={busy} />
          <div style={{ display: "grid", gap: 14 }}>
            {view.roadmap.phases.map((phase) => (
              <PhasePanel
                key={phase.id}
                phase={phase}
                today={view.roadmap.today}
                open={openPhases[phase.id] ?? phaseDefaultsOpen(phase)}
                onToggle={() => togglePhase(phase.id)}
                onSetTask={setTask}
                busy={busy}
              />
            ))}
          </div>
          <ResourcesPanel />
          <p className="app-muted" style={{ fontSize: 13, marginTop: 12 }}>
            {view.roadmap.accuracyNote}
          </p>
        </>
      )}
    </main>
  );
}

/** Open a phase by default when it has something live in it. Nothing is hidden by surprise. */
function phaseDefaultsOpen(phase: RoadmapPhaseView): boolean {
  return phase.tasks.some((task) => task.urgency === "now" || task.urgency === "overdue");
}

function KickoffPanel({
  live,
  value,
  onChange,
  onSave,
  onClear,
  onToggleRookie,
  busy,
}: {
  live: LiveView;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  onToggleRookie: () => void;
  busy: boolean;
}) {
  const { roadmap } = live;
  const hasKickoff = roadmap.kickoffDate != null;
  const rookieSource =
    live.rookiePreference != null
      ? "Your team chose this."
      : live.rookieKnown === true
        ? `Your team is in its first two seasons according to FIRST's team data${
            live.teamNumber ? ` for team ${live.teamNumber}` : ""
          }.`
        : live.rookieKnown === false
          ? "FIRST's team data says you are past your rookie years, so everything is shown."
          : "We do not know how old your team is, so nothing is hidden — turn this on if you are a rookie team.";

  return (
    <Panel style={{ display: "grid", gap: 12, marginBottom: 14 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18 }}>Your kickoff date</h2>
        <p className="app-muted" style={{ margin: "4px 0 0", fontSize: 14 }}>
          FIRST sets a new kickoff date every season and we do not assume it. Enter yours and every
          window below turns into real dates.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label htmlFor="roadmap-kickoff" style={{ fontSize: 14, fontWeight: 600 }}>
          Kickoff (Saturday)
        </label>
        <input
          id="roadmap-kickoff"
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{
            ...TAP,
            border: "1px solid var(--app-line)",
            borderRadius: "var(--app-radius)",
            background: "var(--app-surface)",
            color: "var(--app-ink)",
            minWidth: 160,
          }}
        />
        <Button variant="primary" type="button" style={TAP} onClick={onSave} disabled={busy}>
          {hasKickoff ? "Update dates" : "Set dates"}
        </Button>
        {hasKickoff ? (
          <Button variant="secondary" type="button" style={TAP} onClick={onClear} disabled={busy}>
            Clear
          </Button>
        ) : null}
      </div>

      {hasKickoff ? (
        <p className="app-muted" style={{ margin: 0, fontSize: 13 }}>
          Kickoff {formatIsoDate(roadmap.kickoffDate!)} · today {formatIsoDate(roadmap.today)}
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "var(--app-warning)" }}>
          No kickoff date set. The checklist below is complete and usable, but it is phrased in weeks
          relative to kickoff rather than dates — we will not make a date up for you.
        </p>
      )}

      <ProgressMeter
        label="Roadmap progress"
        value={roadmap.summary.done}
        target={Math.max(1, roadmap.summary.total - roadmap.summary.skipped)}
        unit="tasks"
        status={summaryLine(roadmap.summary, hasKickoff)}
        state={roadmap.summary.total > 0 ? "configured" : "empty"}
      />

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          borderTop: "1px solid var(--app-line)",
          paddingTop: 12,
        }}
      >
        <button
          type="button"
          className={roadmap.rookieOnly ? "app-button" : "app-button secondary"}
          style={TAP}
          onClick={onToggleRookie}
          disabled={busy}
          aria-pressed={roadmap.rookieOnly}
        >
          {roadmap.rookieOnly ? "Showing rookie-critical only" : "Show rookie-critical only"}
        </button>
        <span className="app-muted" style={{ fontSize: 13, flex: "1 1 220px" }}>
          {rookieSource}
        </span>
      </div>
    </Panel>
  );
}

function DueNextPanel({
  roadmap,
  onSetTask,
  busy,
}: {
  roadmap: SeasonRoadmapView;
  onSetTask: (taskId: string, status: TaskStatus) => void;
  busy: boolean;
}) {
  if (roadmap.dueNext.length === 0) {
    return (
      <Panel style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>What is due next</h2>
        <p className="app-muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
          Every task on this roadmap is ticked off or skipped. Nothing is outstanding.
        </p>
      </Panel>
    );
  }

  return (
    <Panel style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>What is due next</h2>
      <p className="app-muted" style={{ margin: "4px 0 12px", fontSize: 14 }}>
        {roadmap.kickoffDate
          ? "Ordered by the windows your kickoff date implies."
          : "Ordered by where each task sits in the season. Set a kickoff date to get real dates."}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {roadmap.dueNext.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={roadmap.today}
            onSetTask={onSetTask}
            busy={busy}
            compact
          />
        ))}
      </ul>
    </Panel>
  );
}

function PhasePanel({
  phase,
  today,
  open,
  onToggle,
  onSetTask,
  busy,
}: {
  phase: RoadmapPhaseView;
  today: string;
  open: boolean;
  onToggle: () => void;
  onSetTask: (taskId: string, status: TaskStatus) => void;
  busy: boolean;
}) {
  const range = formatDateRange(phase.dates);
  const bodyId = `roadmap-phase-${phase.id}`;

  if (phase.totalCount === 0) {
    return (
      <Panel>
        <h2 style={{ margin: 0, fontSize: 17 }}>{phase.label}</h2>
        <p className="app-muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
          Nothing in this phase is rookie-critical, so it is hidden by the filter above.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        style={{
          ...TAP,
          width: "100%",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "baseline",
          justifyContent: "space-between",
          background: "transparent",
          border: "none",
          color: "var(--app-ink)",
          cursor: "pointer",
          textAlign: "left",
          padding: 0,
        }}
      >
        <span style={{ display: "grid", gap: 2 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{phase.label}</span>
          <span className="app-muted" style={{ fontSize: 13 }}>
            {range ?? "Dates appear once you set a kickoff date"}
          </span>
        </span>
        <span className="app-muted" style={{ fontSize: 13 }}>
          {phase.doneCount} / {phase.totalCount} done{open ? " ▾" : " ▸"}
        </span>
      </button>

      {open ? (
        <div id={bodyId} style={{ marginTop: 10 }}>
          <p className="app-muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
            {phase.blurb}
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
            {phase.tasks.map((task) => (
              <TaskRow key={task.id} task={task} today={today} onSetTask={onSetTask} busy={busy} />
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function TaskRow({
  task,
  today,
  onSetTask,
  busy,
  compact = false,
}: {
  task: RoadmapTaskView;
  today: string;
  onSetTask: (taskId: string, status: TaskStatus) => void;
  busy: boolean;
  compact?: boolean;
}) {
  const tone = toneColor(URGENCY_TONES[task.urgency]);
  const countdown = countdownLabel(task.dates, today);
  const range = formatDateRange(task.dates);
  const dim = task.status !== "todo";

  return (
    <li
      style={{
        border: "1px solid var(--app-line)",
        borderLeft: `4px solid ${tone}`,
        borderRadius: "var(--app-radius)",
        background: "var(--app-soft)",
        padding: 12,
        opacity: dim ? 0.72 : 1,
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontWeight: 700, fontSize: 15, flex: "1 1 200px" }}>
          {task.title}
          {task.isRookieCritical ? (
            <span
              className="app-muted"
              style={{ fontWeight: 600, fontSize: 12, marginLeft: 8, whiteSpace: "nowrap" }}
            >
              rookie-critical
            </span>
          ) : null}
        </span>
        <span style={{ color: tone, fontSize: 13, fontWeight: 600 }}>
          {URGENCY_LABELS[task.urgency]}
        </span>
      </div>

      <p className="app-muted" style={{ margin: 0, fontSize: 13 }}>
        {range ?? task.whenLabel}
        {countdown ? ` · ${countdown}` : ""} · {ownerLabel(task.ownerRole)}
      </p>

      {compact ? null : (
        <p style={{ margin: 0, fontSize: 14, color: "var(--app-ink)" }}>
          <strong style={{ fontWeight: 600 }}>Why: </strong>
          {task.why}
        </p>
      )}

      {!compact && task.caveat ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--app-warning)" }}>{task.caveat}</p>
      ) : null}

      {!compact && task.resourceLinks.length > 0 ? (
        <p style={{ margin: 0, fontSize: 13, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {task.resourceLinks.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener">
              {link.label}
            </a>
          ))}
        </p>
      ) : null}

      {task.status === "done" && task.completedByName ? (
        <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
          Ticked off by {task.completedByName}
          {task.completedAt ? ` on ${formatIsoDate(task.completedAt.slice(0, 10)) ?? ""}` : ""}
        </p>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {task.status === "todo" ? (
          <>
            <Button variant="primary" type="button" style={TAP} onClick={() => onSetTask(task.id, "done")} disabled={busy}>
              Mark done
            </Button>
            <Button variant="secondary" type="button" style={TAP} onClick={() => onSetTask(task.id, "skipped")} disabled={busy}>
              Not for us
            </Button>
          </>
        ) : (
          <Button variant="secondary" type="button" style={TAP} onClick={() => onSetTask(task.id, "todo")} disabled={busy}>
            Reopen
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * The community's own free material, linked not copied. The research is explicit that
 * these resources are excellent and beloved, and that authoring a competing curriculum
 * would read as AI slop — so this panel points at them and stops.
 */
function ResourcesPanel() {
  const groups = useMemo(
    () =>
      [
        { topic: "rookie" as const, label: "Start here if you are new" },
        { topic: "strategy" as const, label: "Deciding what to build" },
        { topic: "programming" as const, label: "Programming" },
        { topic: "cad" as const, label: "CAD" },
      ].map((group) => ({ ...group, entries: resourcesFor(group.topic, 4) })),
    [],
  );

  return (
    <Panel style={{ marginTop: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Where to learn this properly</h2>
      <p className="app-muted" style={{ margin: "4px 0 12px", fontSize: 14 }}>
        Vantage does not write FRC training material. These are the free, community-maintained
        resources teams actually recommend.
      </p>
      <div style={{ display: "grid", gap: 14 }}>
        {groups.map((group) => (
          <div key={group.topic}>
            <h3 style={{ margin: "0 0 6px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".04em" }}>
              {group.label}
            </h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {group.entries.map((entry) => (
                <li key={entry.id} style={{ fontSize: 14 }}>
                  <a href={entry.url} target="_blank" rel="noreferrer noopener" style={{ fontWeight: 600 }}>
                    {entry.title}
                  </a>
                  <span className="app-muted"> — {entry.oneLine}</span>
                  <span className="app-muted" style={{ display: "block", fontSize: 12 }}>
                    Maintained by {entry.maintainer}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="app-muted" style={{ margin: "12px 0 0", fontSize: 12 }}>
        {RESOURCE_FRESHNESS_NOTE}
      </p>
    </Panel>
  );
}
