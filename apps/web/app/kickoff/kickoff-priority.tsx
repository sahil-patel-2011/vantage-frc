"use client";

import { useState } from "react";
import { EmptyState, Button } from "../../components/ui";
import { PRIORITY_STATUSES, type DesignPriority, type ScoringAction } from "../../lib/kickoff";
import { hubHref } from "../../lib/nav/hubs";
import type { RunFn } from "./kickoff-model";

export function PrioritySection({
  priorities,
  actions,
  orgId,
  seasonYear,
  busyKey,
  run,
}: {
  priorities: DesignPriority[];
  actions: ScoringAction[];
  orgId: string;
  seasonYear: number;
  busyKey: string | null;
  run: RunFn;
}) {
  const [capability, setCapability] = useState("");
  const [rationale, setRationale] = useState("");
  const [weightText, setWeightText] = useState("3");
  const [linkedId, setLinkedId] = useState("");
  const busy = busyKey != null;
  const sorted = [...priorities].sort((a, b) => b.weight - a.weight);

  return (
    <section className="app-card soft-panel kick-section">
      <h2>Design priorities</h2>
      <p className="app-muted">
        Turn the best-value actions into weighted robot capabilities — seeded from intelligence or entered by the team.
        Open <a href={hubHref("/competition", "strategy", orgId)}>Strategy</a> after seeding.
      </p>

      {sorted.length === 0 ? (
        <EmptyState
          soft
          title="No priorities yet"
          description="Generate a release summary above to seed Strategy priorities, or add capabilities manually."
        >
          <Button as="a" variant="primary" href={hubHref("/competition", "strategy", orgId)}>
            Open Strategy
          </Button>
        </EmptyState>
      ) : (
        <ul className="kick-list">
          {sorted.map((priority) => {
            const rowKey = `priority:${priority.id}`;
            const rowBusy = busyKey === rowKey;
            return (
              <li key={priority.id} className="kick-priority">
                <div className="kick-priority-text">
                  <strong>{priority.capability}</strong>
                  {priority.rationale ? <small className="app-muted">{priority.rationale}</small> : null}
                </div>
                <div className="kick-weight" role="group" aria-label={`Weight for ${priority.capability}`}>
                  {[1, 2, 3, 4, 5].map((weight) => (
                    <button
                      key={weight}
                      type="button"
                      className={weight === priority.weight ? "kick-weight-btn active" : "kick-weight-btn"}
                      disabled={rowBusy}
                      onClick={() => {
                        if (weight !== priority.weight) {
                          void run({ action: "update_priority", orgId, id: priority.id, weight }, rowKey);
                        }
                      }}
                    >
                      {weight}
                    </button>
                  ))}
                </div>
                <select
                  value={priority.status}
                  disabled={rowBusy}
                  aria-label={`Status for ${priority.capability}`}
                  onChange={(event) => void run({ action: "update_priority", orgId, id: priority.id, status: event.target.value }, rowKey)}
                >
                  {PRIORITY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <select
                  value={priority.linkedActionId ?? ""}
                  disabled={rowBusy}
                  aria-label={`Linked action for ${priority.capability}`}
                  onChange={(event) =>
                    void run({ action: "update_priority", orgId, id: priority.id, linkedActionId: event.target.value || null }, rowKey)
                  }
                >
                  <option value="">No linked action</option>
                  {actions.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                  {priority.linkedActionId != null && !actions.some((entry) => entry.id === priority.linkedActionId) ? (
                    <option value={priority.linkedActionId}>Linked (other season)</option>
                  ) : null}
                </select>
                <button
                  type="button"
                  className="kick-link danger"
                  aria-label={`Delete ${priority.capability}`}
                  disabled={busy}
                  onClick={() => void run({ action: "delete_priority", orgId, id: priority.id }, rowKey)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="kick-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!capability.trim()) return;
          void run(
            {
              action: "add_priority",
              orgId,
              seasonYear,
              capability: capability.trim(),
              rationale: rationale.trim(),
              weight: Number(weightText),
              linkedActionId: linkedId || null,
            },
            "add-priority",
          ).then(() => {
            setCapability("");
            setRationale("");
            setWeightText("3");
            setLinkedId("");
          });
        }}
      >
        <input
          value={capability}
          disabled={busy}
          placeholder="Capability (e.g. Fast ground intake)"
          onChange={(event) => setCapability(event.target.value)}
        />
        <input value={rationale} disabled={busy} placeholder="Why it matters" onChange={(event) => setRationale(event.target.value)} />
        <select value={weightText} disabled={busy} aria-label="Weight" onChange={(event) => setWeightText(event.target.value)}>
          {[1, 2, 3, 4, 5].map((weight) => (
            <option key={weight} value={String(weight)}>
              Weight {weight}
            </option>
          ))}
        </select>
        <select value={linkedId} disabled={busy} aria-label="Linked action" onChange={(event) => setLinkedId(event.target.value)}>
          <option value="">No linked action</option>
          {actions.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <Button variant="secondary" type="submit" disabled={busy || !capability.trim()}>
          Add priority
        </Button>
      </form>
    </section>
  );
}
