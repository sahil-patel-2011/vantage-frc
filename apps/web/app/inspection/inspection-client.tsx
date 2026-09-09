"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import { EmptyState } from "../../components/ui";
import {
  groupByCategory,
  inspectionProgress,
  weightStatus,
  type InspectionItem,
  type InspectionStatus,
  type InspectionView,
} from "../../lib/inspection";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

const STATUS_LABEL: Record<InspectionStatus, string> = { pending: "—", pass: "Pass", fail: "Fail", na: "N/A" };

function fmtWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ItemRow({
  item,
  busy,
  onStatus,
  onDelete,
}: {
  item: InspectionItem;
  busy: boolean;
  onStatus: (status: InspectionStatus, note?: string) => void;
  onDelete: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(item.note);
  useEffect(() => setNote(item.note), [item.note]);

  return (
    <li className={`insp-item s-${item.status}`}>
      <div className="insp-item-main">
        <span className="insp-req">
          {item.requirement}
          {item.isCustom ? <em className="insp-custom">custom</em> : null}
          {item.note ? <small className="app-muted"> · {item.note}</small> : null}
        </span>
        <span className="insp-buttons" role="group" aria-label="Set status">
          {(["pass", "fail", "na"] as const).map((status) => (
            <button
              key={status}
              type="button"
              className={item.status === status ? `insp-btn ${status} active` : `insp-btn ${status}`}
              disabled={busy}
              onClick={() => onStatus(item.status === status ? "pending" : status)}
            >
              {STATUS_LABEL[status]}
            </button>
          ))}
          <button type="button" className="insp-link" disabled={busy} onClick={() => setNoteOpen((value) => !value)}>
            Note
          </button>
          {item.isCustom ? (
            <button type="button" className="insp-link danger" disabled={busy} onClick={onDelete} aria-label="Delete item">
              ✕
            </button>
          ) : null}
        </span>
      </div>
      {item.checkedByName && item.checkedAt && item.status !== "pending" ? (
        <small className="insp-meta">
          {STATUS_LABEL[item.status]} by {item.checkedByName} · {fmtWhen(item.checkedAt)}
        </small>
      ) : null}
      {noteOpen ? (
        <form
          className="insp-note-form"
          onSubmit={(event) => {
            event.preventDefault();
            onStatus(item.status, note.trim());
            setNoteOpen(false);
          }}
        >
          <input value={note} disabled={busy} placeholder="e.g. Need to re-torque main breaker mount" onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="app-button secondary sm" disabled={busy}>
            Save note
          </button>
        </form>
      ) : null}
    </li>
  );
}

export default function InspectionClient() {
  const [view, setView] = useState<InspectionView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [robotLabel, setRobotLabel] = useState("competition");
  const [customCategory, setCustomCategory] = useState("Game-specific");
  const [customReq, setCustomReq] = useState("");
  const [weightInput, setWeightInput] = useState("");
  const [weightConfig, setWeightConfig] = useState("with bumpers");
  const [limitInput, setLimitInput] = useState("");

  const load = useCallback(async () => {
    setFetchFailed(false);
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/inspection${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as InspectionView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load inspection.");
        setErrorStatus(response.status);
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
        const response = await fetch("/api/inspection", {
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
  const robotItems = useMemo(
    () => (ready ? ready.items.filter((item) => item.robotLabel === robotLabel) : []),
    [ready, robotLabel],
  );
  const robotLabels = useMemo(() => {
    const labels = new Set<string>(["competition"]);
    for (const item of ready?.items ?? []) labels.add(item.robotLabel);
    for (const weight of ready?.weights ?? []) labels.add(weight.robotLabel);
    labels.add("practice");
    return [...labels];
  }, [ready]);

  if (fetchFailed || !view) {
    return (
      <main className="module-page insp-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Inspection</span>
            <h1>Robot Inspection</h1>
          </div>
        </header>
        <div className="app-card insp-empty">
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
                message: error || "Check your connection and try again.",
              });
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
            <p className="app-muted">Loading inspection…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page insp-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Inspection</span>
            <h1>Robot Inspection</h1>
            <p>Self-inspect against the standard checklist before the real inspector arrives.</p>
          </div>
        </header>
        <EmptyState className="insp-empty" title="Select a team workspace" description={view.message}>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </EmptyState>
      </main>
    );
  }

  const orgId = view.context.orgId ?? "";
  const canAdmin = view.context.role === "owner" || view.context.role === "admin";
  const progress = inspectionProgress(robotItems);
  const groups = groupByCategory(robotItems);
  const robotWeights = view.weights.filter((weight) => weight.robotLabel === robotLabel);
  const scale = weightStatus(robotWeights, view.weightLimitLbs);
  const busy = busyKey != null;

  return (
    <main className="module-page insp-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Inspection</span>
          <h1>Robot Inspection</h1>
          <p>
            Pre-inspection checklist and weigh-ins for {view.context.orgName ?? "your team"}
            {view.context.teamNumber ? ` (Team ${view.context.teamNumber})` : ""}. Not an official inspection — pass the
            real one at the event.
          </p>
        </div>
        <div className="insp-header-actions">
          <select value={robotLabel} aria-label="Robot" onChange={(event) => setRobotLabel(event.target.value)}>
            {robotLabels.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
          {progress.ready ? <span className="app-badge good">Ready for inspection</span> : null}
          {/* This checklist is one step of a three-step job: check the robot,
              weigh it, then work the copilot's flags. It used to end here with
              no way forward. */}
          <nav className="product-hub-related" aria-label="Related inspection tools">
            <a className="app-button secondary" href={withOrgHref("/robot-weigh-in", orgId || null)}>
              Weigh-in
            </a>
            <a className="app-button secondary" href={withOrgHref("/inspection-copilot", orgId || null)}>
              Inspection copilot
            </a>
          </nav>
        </div>
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <div className="insp-summary">
        <div className="insp-summary-tile">
          <strong>{progress.percent}%</strong>
          <span>
            resolved · {progress.pass} pass / {progress.fail} fail / {progress.pending} open
          </span>
          <span className="insp-track">
            <i style={{ width: `${progress.percent}%` }} className={progress.fail > 0 ? "warn" : undefined} />
          </span>
        </div>
        <div className={scale.over ? "insp-summary-tile warn" : "insp-summary-tile"}>
          <strong>{scale.latest ? `${scale.latest.totalLbs} lb` : "—"}</strong>
          <span>
            latest weight vs {view.weightLimitLbs} lb limit
            {scale.marginLbs != null ? ` · ${scale.over ? `${Math.abs(scale.marginLbs)} lb OVER` : `${scale.marginLbs} lb margin`}` : ""}
          </span>
        </div>
      </div>

      <div className="insp-layout">
        <section className="insp-panel">
          {robotItems.length === 0 ? (
            <EmptyState
              className="insp-empty"
              title={`No checklist yet for “${robotLabel}”`}
              description="Load the standard FRC self-inspection checklist, then add game-specific items."
            >
              <button
                type="button"
                className="app-button"
                disabled={busy}
                onClick={() => void run({ action: "seed_checklist", orgId, robotLabel }, "seed")}
              >
                Load standard checklist
              </button>
            </EmptyState>
          ) : (
            <>
              {groups.map((group) => (
                <article key={group.category} className="app-card insp-group">
                  <h2>{group.category}</h2>
                  <ul>
                    {group.items.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        busy={busyKey === `item:${item.id}`}
                        onStatus={(status, note) =>
                          void run(
                            { action: "set_status", orgId, id: item.id, status, ...(note !== undefined ? { note } : {}) },
                            `item:${item.id}`,
                          )
                        }
                        onDelete={() => void run({ action: "delete_item", orgId, id: item.id }, `item:${item.id}`)}
                      />
                    ))}
                  </ul>
                </article>
              ))}
              <form
                className="insp-add app-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!customReq.trim()) return;
                  void run(
                    { action: "add_item", orgId, robotLabel, category: customCategory.trim() || "Game-specific", requirement: customReq.trim() },
                    "add-item",
                  ).then(() => setCustomReq(""));
                }}
              >
                <h2>Add game-specific item</h2>
                <div className="insp-add-row">
                  <input value={customCategory} disabled={busy} placeholder="Category" onChange={(e) => setCustomCategory(e.target.value)} />
                  <input
                    value={customReq}
                    disabled={busy}
                    placeholder="Requirement (e.g. Extension within this year's limit)"
                    onChange={(e) => setCustomReq(e.target.value)}
                  />
                  <button type="submit" className="app-button secondary" disabled={busy || !customReq.trim()}>
                    Add
                  </button>
                </div>
                <div className="insp-tools">
                  <button type="button" className="insp-link" disabled={busy} onClick={() => void run({ action: "seed_checklist", orgId, robotLabel }, "seed")}>
                    Re-sync standard items
                  </button>
                  <button
                    type="button"
                    className="insp-link danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm("Reset every item on this robot to pending? (Keeps custom items.)")) {
                        void run({ action: "reset_checklist", orgId, robotLabel }, "reset");
                      }
                    }}
                  >
                    Reset for next event
                  </button>
                </div>
              </form>
            </>
          )}
        </section>

        <section className="insp-panel">
          <article className="app-card insp-weigh">
            <h2>Weigh-in</h2>
            <form
              className="insp-weigh-form"
              onSubmit={(event) => {
                event.preventDefault();
                const lbs = Number(weightInput);
                if (!Number.isFinite(lbs) || lbs <= 0) return;
                void run(
                  { action: "log_weight", orgId, robotLabel, totalLbs: lbs, config: weightConfig.trim() },
                  "weigh",
                ).then(() => setWeightInput(""));
              }}
            >
              <input
                type="number"
                step="any"
                min={0}
                placeholder="lbs"
                value={weightInput}
                disabled={busy}
                onChange={(e) => setWeightInput(e.target.value)}
              />
              <input value={weightConfig} disabled={busy} placeholder="Configuration" onChange={(e) => setWeightConfig(e.target.value)} />
              <button type="submit" className="app-button" disabled={busy || !weightInput}>
                Log weight
              </button>
            </form>
            {canAdmin ? (
              <form
                className="insp-limit-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const limit = Number(limitInput);
                  if (!Number.isFinite(limit) || limit <= 0) return;
                  void run({ action: "set_weight_limit", orgId, weightLimitLbs: limit }, "limit").then(() => setLimitInput(""));
                }}
              >
                <input
                  type="number"
                  step="any"
                  min={0}
                  placeholder={`Limit (${view.weightLimitLbs} lb)`}
                  value={limitInput}
                  disabled={busy}
                  onChange={(e) => setLimitInput(e.target.value)}
                />
                <button type="submit" className="app-button secondary sm" disabled={busy || !limitInput}>
                  Set season limit
                </button>
              </form>
            ) : null}
            <ul className="insp-weights">
              {robotWeights.map((weight) => (
                <li key={weight.id} className={weight.totalLbs > view.weightLimitLbs ? "over" : undefined}>
                  <span>
                    <b>{weight.totalLbs} lb</b>
                    {weight.config ? ` · ${weight.config}` : ""}
                    <small className="app-muted">
                      {" "}
                      {fmtWhen(weight.weighedAt)}
                      {weight.recordedByName ? ` · ${weight.recordedByName}` : ""}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="insp-link danger"
                    aria-label="Delete weigh-in"
                    disabled={busy}
                    onClick={() => void run({ action: "delete_weight", orgId, id: weight.id }, `w:${weight.id}`)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {robotWeights.length === 0 ? <p className="app-muted">No weigh-ins yet for this robot.</p> : null}
          </article>
          <AiInsightPanel
            orgId={orgId}
            kind="inspection_advisor"
            robotLabel={robotLabel}
            title="Inspection advisor"
            description="Prioritized pass-inspection plan from your checklist, failures, and weigh-ins."
          />
        </section>
      </div>
    </main>
  );
}
