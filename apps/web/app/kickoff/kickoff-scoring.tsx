"use client";

import { useState } from "react";
import { EmptyState, Button } from "../../components/ui";
import { PHASES, pointsPerSecond, rankActions, type Phase, type ScoringAction } from "../../lib/kickoff";
import type { RunFn } from "./kickoff-model";

export function ScoringSection({
  actions,
  orgId,
  seasonYear,
  busyKey,
  run,
}: {
  actions: ScoringAction[];
  orgId: string;
  seasonYear: number;
  busyKey: string | null;
  run: RunFn;
}) {
  const [label, setLabel] = useState("");
  const [phase, setPhase] = useState<Phase>("teleop");
  const [pointsText, setPointsText] = useState("");
  const [secondsText, setSecondsText] = useState("");
  const busy = busyKey != null;
  const ranked = rankActions(actions);

  return (
    <section className="app-card soft-panel kick-section">
      <h2>Scoring analysis</h2>
      <p className="app-muted">
        List every way to score from the game manual, estimate cycle time, and let points per second show where the
        value is.
      </p>

      {ranked.length === 0 ? (
        <EmptyState
          soft
          title="No scoring actions yet"
          description={`Add actions from the ${seasonYear} manual, or generate them from uploaded release materials above.`}
        />
      ) : (
        <div className="kick-table">
          <div className="kick-row kick-row-head" aria-hidden="true">
            <span>Action</span>
            <span>Phase</span>
            <span>Points</span>
            <span>Est. sec</span>
            <span>Pts/sec</span>
            <span />
          </div>
          {ranked.map((action) => {
            const rate = pointsPerSecond(action);
            const rowKey = `action:${action.id}`;
            const rowBusy = busyKey === rowKey;
            return (
              <div key={action.id} className="kick-row">
                <span className="kick-label">
                  {action.label}
                  {action.notes ? <small className="app-muted">{action.notes}</small> : null}
                </span>
                <span className={`kick-chip kick-phase-${action.phase}`}>{action.phase}</span>
                <input
                  key={`pts-${action.id}-${action.points}`}
                  type="number"
                  className="kick-num"
                  min={0}
                  max={1000}
                  step={0.5}
                  defaultValue={action.points}
                  disabled={rowBusy}
                  aria-label={`Points for ${action.label}`}
                  onBlur={(event) => {
                    const raw = event.target.value.trim();
                    if (raw === "") return;
                    const next = Number(raw);
                    if (!Number.isFinite(next) || next < 0 || next > 1000 || next === action.points) return;
                    void run({ action: "update_action", orgId, id: action.id, points: next }, rowKey);
                  }}
                />
                <input
                  key={`sec-${action.id}-${action.estSeconds ?? "none"}`}
                  type="number"
                  className="kick-num"
                  min={0}
                  max={600}
                  step={0.5}
                  placeholder="—"
                  defaultValue={action.estSeconds ?? ""}
                  disabled={rowBusy}
                  aria-label={`Estimated seconds for ${action.label}`}
                  onBlur={(event) => {
                    const raw = event.target.value.trim();
                    const next = raw === "" ? null : Number(raw);
                    if (next != null && (!Number.isFinite(next) || next <= 0 || next > 600)) return;
                    if (next === action.estSeconds) return;
                    void run({ action: "update_action", orgId, id: action.id, estSeconds: next }, rowKey);
                  }}
                />
                <b className="kick-rate">{rate == null ? "—" : rate.toFixed(2)}</b>
                <button
                  type="button"
                  className="kick-link danger"
                  aria-label={`Delete ${action.label}`}
                  disabled={busy}
                  onClick={() => void run({ action: "delete_action", orgId, id: action.id }, rowKey)}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      <form
        className="kick-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!label.trim() || pointsText.trim() === "") return;
          void run(
            {
              action: "add_action",
              orgId,
              seasonYear,
              label: label.trim(),
              phase,
              points: Number(pointsText),
              estSeconds: secondsText.trim() === "" ? null : Number(secondsText),
            },
            "add-action",
          ).then(() => {
            setLabel("");
            setPointsText("");
            setSecondsText("");
          });
        }}
      >
        <input
          value={label}
          disabled={busy}
          placeholder="Scoring action (e.g. Score in high goal)"
          onChange={(event) => setLabel(event.target.value)}
        />
        <select value={phase} disabled={busy} aria-label="Phase" onChange={(event) => setPhase(event.target.value as Phase)}>
          {PHASES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          type="number"
          className="kick-num-add"
          min={0}
          max={1000}
          step={0.5}
          value={pointsText}
          disabled={busy}
          placeholder="Points"
          onChange={(event) => setPointsText(event.target.value)}
        />
        <input
          type="number"
          className="kick-num-add"
          min={0}
          max={600}
          step={0.5}
          value={secondsText}
          disabled={busy}
          placeholder="Est. sec"
          onChange={(event) => setSecondsText(event.target.value)}
        />
        <Button variant="secondary" type="submit" disabled={busy || !label.trim() || pointsText.trim() === ""}>
          Add action
        </Button>
      </form>
    </section>
  );
}
