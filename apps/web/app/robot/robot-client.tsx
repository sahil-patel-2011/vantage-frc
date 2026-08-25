"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import { EmptyState } from "../../components/ui";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  cadProvider,
  robotRollup,
  STATUS_LABELS,
  SUBSYSTEM_STATUSES,
  subsystemReadiness,
  type BlueprintView,
  type EnrichedSubsystem,
  type PriorityOption,
} from "../../lib/robot-blueprint";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

function LinkEditor({
  value,
  placeholder,
  buttonLabel,
  busy,
  onSave,
}: {
  value: string;
  placeholder: string;
  buttonLabel: string;
  busy: boolean;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <button type="button" className="robot-link" disabled={busy} onClick={() => setEditing(true)}>
        {buttonLabel}
      </button>
    );
  }
  return (
    <form
      className="robot-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft.trim());
        setEditing(false);
      }}
    >
      <input value={draft} placeholder={placeholder} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit" className="app-button secondary sm" disabled={busy}>
        Save
      </button>
      <button type="button" className="robot-link" disabled={busy} onClick={() => setEditing(false)}>
        Cancel
      </button>
    </form>
  );
}

function SubsystemCard({
  subsystem,
  priorities,
  orgId,
  busyKey,
  run,
}: {
  subsystem: EnrichedSubsystem;
  priorities: PriorityOption[];
  orgId: string;
  busyKey: string | null;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const busy = busyKey === `sub:${subsystem.id}`;
  const readiness = subsystemReadiness(subsystem);
  const patch = (fields: Record<string, unknown>) =>
    run({ action: "update_subsystem", orgId, id: subsystem.id, ...fields }, `sub:${subsystem.id}`);
  const provider = cadProvider(subsystem.cadUrl);
  const withOrg = (href: string) => (orgId ? `${href}?orgId=${encodeURIComponent(orgId)}` : href);

  return (
    <article className="robot-card app-card">
      <header className="robot-card-head">
        <div>
          <strong>{subsystem.name}</strong>
          {subsystem.description ? <p className="app-muted">{subsystem.description}</p> : null}
        </div>
        <select
          value={subsystem.status}
          disabled={busy}
          aria-label="Status"
          onChange={(event) => void patch({ status: event.target.value })}
        >
          {SUBSYSTEM_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </header>

      <div className="robot-readiness">
        <div className="robot-track">
          <i style={{ width: `${readiness.percent}%` }} className={readiness.percent >= 100 ? "done" : readiness.blockers.length ? "warn" : undefined} />
        </div>
        <span>{readiness.percent}%</span>
      </div>
      {readiness.blockers.length ? <p className="robot-blockers">⚠ {readiness.blockers.join(" · ")}</p> : null}

      <div className="robot-links">
        <div className="robot-domain">
          <span className="robot-domain-label">CAD</span>
          {subsystem.cadUrl ? (
            <span className="robot-domain-value">
              <a className="robot-cad-btn" href={subsystem.cadUrl} target="_blank" rel="noopener noreferrer">
                Open {provider ?? "CAD"}
              </a>
              <button type="button" className="robot-link" disabled={busy} onClick={() => void patch({ cadUrl: null })}>
                unlink
              </button>
            </span>
          ) : (
            <LinkEditor value="" placeholder="https://cad.onshape.com/…" buttonLabel="+ Link CAD model" busy={busy} onSave={(next) => void patch({ cadUrl: next || null })} />
          )}
        </div>

        <div className="robot-domain">
          <span className="robot-domain-label">Code</span>
          {subsystem.codeRef ? (
            <span className="robot-domain-value">
              <code className="robot-code">{subsystem.codeRef}</code>
              <button type="button" className="robot-link" disabled={busy} onClick={() => void patch({ codeRef: "" })}>
                clear
              </button>
            </span>
          ) : (
            <LinkEditor
              value=""
              placeholder="src/main/java/frc/robot/subsystems/Drivetrain.java"
              buttonLabel="+ Set code ref"
              busy={busy}
              onSave={(next) => void patch({ codeRef: next })}
            />
          )}
        </div>

        <div className="robot-domain">
          <span className="robot-domain-label">Strategy</span>
          <select
            value={subsystem.priorityId ?? ""}
            disabled={busy}
            aria-label="Linked design priority"
            onChange={(event) => void patch({ priorityId: event.target.value || null })}
          >
            <option value="">No linked priority</option>
            {priorities.map((priority) => (
              <option key={priority.id} value={priority.id}>
                {priority.capability} (w{priority.weight} · {priority.status})
              </option>
            ))}
          </select>
        </div>

        <div className="robot-domain">
          <span className="robot-domain-label">Practice</span>
          <span className="robot-domain-value">
            <LinkEditor
              value={subsystem.practiceAction ?? ""}
              placeholder='driver_cycles action, e.g. "Full cycle"'
              buttonLabel={subsystem.practiceAction ? `“${subsystem.practiceAction}”` : "+ Map practice action"}
              busy={busy}
              onSave={(next) => void patch({ practiceAction: next || null })}
            />
            {subsystem.ops.practice ? (
              <small className="app-muted">
                {subsystem.ops.practice.reps} reps
                {subsystem.ops.practice.successRate != null ? ` · ${subsystem.ops.practice.successRate}%` : ""}
                {subsystem.ops.practice.avgSeconds != null ? ` · ${subsystem.ops.practice.avgSeconds}s` : ""}
              </small>
            ) : null}
          </span>
        </div>
      </div>

      <footer className="robot-ops">
        <a className={subsystem.ops.bom && !subsystem.ops.bom.buildable ? "robot-chip warn" : "robot-chip"} href={withOrg("/inventory")}>
          BOM: {subsystem.ops.bom ? (subsystem.ops.bom.buildable ? "buildable" : `${subsystem.ops.bom.shortCount} short`) : "not mapped"}
        </a>
        <a className={subsystem.ops.failures7d > 0 ? "robot-chip warn" : "robot-chip"} href={withOrg("/pit")}>
          Failures 7d: {subsystem.ops.failures7d}
        </a>
        <a className={subsystem.ops.openMaintenance > 0 ? "robot-chip warn" : "robot-chip"} href={withOrg("/pit")}>
          Maintenance: {subsystem.ops.openMaintenance}
        </a>
        <button
          type="button"
          className="robot-link danger"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete subsystem "${subsystem.name}"?`)) {
              void run({ action: "delete_subsystem", orgId, id: subsystem.id }, `sub:${subsystem.id}`);
            }
          }}
        >
          Delete
        </button>
      </footer>
    </article>
  );
}

export default function RobotClient() {
  const [view, setView] = useState<BlueprintView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [robotLabel, setRobotLabel] = useState("competition");
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    setFetchFailed(false);
    setFailureStatus(null);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/robot${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as BlueprintView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the robot blueprint.");
        setFailureStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/robot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        await load();
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const ready = view?.status === "ready" ? view : null;
  const robotLabels = useMemo(() => {
    const labels = new Set<string>(["competition"]);
    for (const subsystem of ready?.subsystems ?? []) labels.add(subsystem.robotLabel);
    labels.add("practice");
    return [...labels];
  }, [ready]);
  const robotSubsystems = useMemo(
    () => (ready ? ready.subsystems.filter((subsystem) => subsystem.robotLabel === robotLabel) : []),
    [ready, robotLabel],
  );

  if (fetchFailed || !view) {
    return (
      <main className="module-page robot-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Build / Robot</span>
            <h1>Robot Blueprint</h1>
          </div>
        </header>
        <div className="app-card robot-empty">
          {fetchFailed ? (
            (() => {
              const copy = loadFailureCopy(
                classifyLoadFailure({
                  status: failureStatus,
                  message: error,
                  online: typeof navigator === "undefined" ? true : navigator.onLine,
                }),
                {
                  nextPath:
                    typeof window === "undefined"
                      ? null
                      : `${window.location.pathname}${window.location.search}`,
                  message: error || "Check your connection and try again.",
                },
              );
              return (
                <>
                  <strong>{copy.title}</strong>
                  <p className="app-muted">{copy.description}</p>
                  {copy.primary ? (
                    <a className="app-button" href={copy.primary.href}>
                      {copy.primary.label}
                    </a>
                  ) : null}
                  {copy.showRetry ? (
                    <button type="button" className="app-button secondary" onClick={() => void load()}>
                      Retry
                    </button>
                  ) : null}
                </>
              );
            })()
          ) : (
            <p className="app-muted">Loading robot blueprint…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page robot-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Build / Robot</span>
            <h1>Robot Blueprint</h1>
            <p>Every subsystem linked to its CAD, code, strategy priority, and live ops data.</p>
          </div>
        </header>
        <EmptyState className="robot-empty" title="Select a team workspace" description={view.message}>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </EmptyState>
      </main>
    );
  }

  const orgId = view.context.orgId ?? "";
  const rollup = robotRollup(robotSubsystems);
  const busy = busyKey != null;

  return (
    <main className="module-page robot-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Build / Robot</span>
          <h1>Robot Blueprint</h1>
          <p>
            The digital twin for {view.context.orgName ?? "your team"}
            {view.context.teamNumber ? ` (Team ${view.context.teamNumber})` : ""} — CAD, code, strategy, and ops per
            subsystem, {view.context.seasonYear} season.
          </p>
        </div>
        <div className="robot-header-actions">
          <select value={robotLabel} aria-label="Robot" onChange={(event) => setRobotLabel(event.target.value)}>
            {robotLabels.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <section className="robot-rollup app-card">
        <div className="robot-rollup-main">
          <strong>{rollup.percent}%</strong>
          <div className="robot-track big">
            <i style={{ width: `${rollup.percent}%` }} className={rollup.percent >= 100 ? "done" : undefined} />
          </div>
          <span className="app-muted">
            {rollup.ready}/{rollup.total} competition-ready · {rollup.blockers} active blocker{rollup.blockers === 1 ? "" : "s"}
          </span>
        </div>
        <ul className="robot-gaps">
          <li className={rollup.missingCad ? "gap" : undefined}>CAD links missing: {rollup.missingCad}</li>
          <li className={rollup.missingCode ? "gap" : undefined}>Code refs missing: {rollup.missingCode}</li>
          <li className={rollup.unlinkedStrategy ? "gap" : undefined}>No strategy link: {rollup.unlinkedStrategy}</li>
          <li className={rollup.untested ? "gap" : undefined}>No practice reps: {rollup.untested}</li>
        </ul>
      </section>

      {robotSubsystems.length === 0 ? (
        <EmptyState
          className="robot-empty"
          title={`No subsystems yet for “${robotLabel}”`}
          description="Seed the standard FRC set (drivetrain, intake, scorer…) and then link each to its CAD, code, and strategy."
        >
          <button
            type="button"
            className="app-button"
            disabled={busy}
            onClick={() => void run({ action: "seed_subsystems", orgId, robotLabel }, "seed")}
          >
            Seed standard subsystems
          </button>
        </EmptyState>
      ) : (
        <div className="robot-grid">
          {robotSubsystems.map((subsystem) => (
            <SubsystemCard
              key={subsystem.id}
              subsystem={subsystem}
              priorities={view.priorities}
              orgId={orgId}
              busyKey={busyKey}
              run={run}
            />
          ))}
        </div>
      )}

      <form
        className="robot-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newName.trim()) return;
          void run({ action: "add_subsystem", orgId, robotLabel, name: newName.trim() }, "add").then(() => setNewName(""));
        }}
      >
        <input value={newName} disabled={busy} placeholder="Add a subsystem (e.g. Turret)" onChange={(event) => setNewName(event.target.value)} />
        <button type="submit" className="app-button secondary" disabled={busy || !newName.trim()}>
          Add subsystem
        </button>
        {robotSubsystems.length > 0 ? (
          <button type="button" className="robot-link" disabled={busy} onClick={() => void run({ action: "seed_subsystems", orgId, robotLabel }, "seed")}>
            Re-sync standard set
          </button>
        ) : null}
      </form>

      <nav className="intel-actions" aria-label="Robot systems of record">
        <a href={withOrgHref("/fmea", orgId)}>FMEA</a>
        <a href={withOrgHref("/batteries", orgId)}>Batteries</a>
        <a href={withOrgHref("/robot-weigh-in", orgId)}>Weigh-in</a>
        <a href={withOrgHref("/inspection-copilot", orgId)}>Inspection</a>
        <a href={withOrgHref("/hours", orgId)}>Hours</a>
      </nav>

      <AiInsightPanel
        orgId={orgId}
        kind="robot_blueprint"
        robotLabel={robotLabel}
        title="Blueprint review"
        description="AI read of the digital twin — weakest subsystems with their blockers, missing CAD/code/strategy links, and what to close before the next event."
      />
    </main>
  );
}
