"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Button, Panel } from "../../components/ui";
import {
  PICKLIST_COLLAB_TIERS,
  epaRoleLabel,
  picklistCollabTierLabel,
  picklistEntrySummary,
  type PicklistCollabEntryWithRating,
} from "../../lib/picklist-collab";
import { orderPayload, reorderGroups, sameOrder, type TierGroup } from "../../lib/picklist-collab/reorder";
import type { PicklistCollabTier } from "../../lib/picklist-collab/types";

type Mutate = (payload: Record<string, unknown>) => void;
type Drag = { id: string; tier: PicklistCollabTier; index: number };

/** The team lists, one panel per tier. Drag a handle (finger, mouse) or use the arrow keys. */
export function PicklistTierList({
  groups,
  sliderRank,
  sliderCount,
  busy,
  mutate,
  onReordered,
}: {
  groups: TierGroup[];
  /** team key ("frc254") → place in "Ranked by your sliders". */
  sliderRank: Map<string, number>;
  sliderCount: number;
  busy: boolean;
  mutate: Mutate;
  /** Called once a new order is sent, so the page can switch to "My order". */
  onReordered: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const refocus = useRef<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announce, setAnnounce] = useState("");

  // After a move the row appears in a new place; keep its handle focused so the arrow keys
  // can carry on. Keyed on the visible order, so it runs when the new order arrives.
  const orderKey = groups.map((group) => group.entries.map((entry) => entry.id).join(",")).join("|");
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-handle="${CSS.escape(id)}"]`)?.focus();
  }, [orderKey]);

  /** Which tier and slot the pointer is over, counting only the rows that stay put. */
  function locate(y: number, draggedId: string): { tier: PicklistCollabTier; index: number } | null {
    const lists = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-tier-list]") ?? [])];
    let best: HTMLElement | null = null;
    let bestDistance = Infinity;
    for (const list of lists) {
      const box = list.getBoundingClientRect();
      const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = list;
      }
    }
    if (!best) return null;
    const rows = [...best.querySelectorAll<HTMLElement>("[data-entry-id]")].filter((row) => row.dataset.entryId !== draggedId);
    let index = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const box = rows[i]!.getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        index = i;
        break;
      }
    }
    return { tier: best.dataset.tierList as PicklistCollabTier, index };
  }

  function begin(entry: PicklistCollabEntryWithRating, event: PointerEvent<HTMLButtonElement>) {
    if (busy || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const group = groups.find((item) => item.tier === entry.tier);
    const start = { id: entry.id, tier: entry.tier, index: Math.max(0, group?.entries.findIndex((item) => item.id === entry.id) ?? 0) };
    dragRef.current = start;
    setDrag(start);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) return;
    const target = locate(event.clientY, current.id);
    if (target && (target.tier !== current.tier || target.index !== current.index)) {
      const next = { id: current.id, ...target };
      dragRef.current = next;
      setDrag(next);
    }
    // Scroll while holding a row near the top or bottom edge of the screen.
    if (event.clientY < 72) window.scrollBy(0, -14);
    else if (event.clientY > window.innerHeight - 72) window.scrollBy(0, 14);
  }

  function end(commit: boolean) {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current || !commit) return;
    const next = reorderGroups(groups, current.id, current.tier, current.index);
    if (sameOrder(groups, next)) return;
    refocus.current = current.id;
    mutate(orderPayload(next));
    onReordered();
    const moved = next.find((group) => group.tier === current.tier)?.entries.findIndex((item) => item.id === current.id) ?? 0;
    setAnnounce(`Moved to ${picklistCollabTierLabel(current.tier)}, place ${moved + 1}.`);
  }

  function key(entry: PicklistCollabEntryWithRating, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    if (busy) return;
    const group = groups.find((item) => item.tier === entry.tier);
    const from = group?.entries.findIndex((item) => item.id === entry.id) ?? -1;
    const to = event.key === "ArrowUp" ? from - 1 : from + 1;
    if (!group || from < 0 || to < 0 || to >= group.entries.length) return;
    refocus.current = entry.id;
    mutate(orderPayload(reorderGroups(groups, entry.id, entry.tier, to)));
    onReordered();
    setAnnounce(`Team ${entry.teamNumber} is now place ${to + 1} of ${group.entries.length} in ${picklistCollabTierLabel(entry.tier)}.`);
  }

  return (
    <div ref={rootRef} id="picklist-collab-entries" className="picklist-collab-layout">
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {groups.map(({ tier, entries }) => {
        // Empty tiers stay hidden, also while dragging: revealing them shifts the page under the
        // pointer. A team goes to an empty tier from its "More" menu.
        if (entries.length === 0) return null;
        const rows: ReactNode[] = [];
        let stay = 0;
        const slot = (
          <li key="drop-slot" className="picklist-drop-slot" aria-hidden="true" />
        );
        for (const entry of entries) {
          const isDragged = drag?.id === entry.id;
          if (!isDragged && drag?.tier === tier && stay === drag.index) rows.push(slot);
          if (!isDragged) stay += 1;
          rows.push(
            <EntryRow
              key={entry.id}
              entry={entry}
              busy={busy}
              dragged={isDragged}
              sliderRank={sliderRank.get(`frc${entry.teamNumber}`) ?? null}
              sliderCount={sliderCount}
              mutate={mutate}
              onHandleDown={begin}
              onHandleMove={move}
              onHandleUp={() => end(true)}
              onHandleCancel={() => end(false)}
              onHandleKey={key}
            />,
          );
        }
        if (drag?.tier === tier && stay <= drag.index) rows.push(slot);
        return (
          <Panel key={tier} className="picklist-collab-panel">
            <h2 style={{ marginTop: 0 }}>{picklistCollabTierLabel(tier)}</h2>
            <ul className="picklist-collab-list" data-tier-list={tier}>
              {rows}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

function EntryRow({
  entry,
  busy,
  dragged,
  sliderRank,
  sliderCount,
  mutate,
  onHandleDown,
  onHandleMove,
  onHandleUp,
  onHandleCancel,
  onHandleKey,
}: {
  entry: PicklistCollabEntryWithRating;
  busy: boolean;
  dragged: boolean;
  sliderRank: number | null;
  sliderCount: number;
  mutate: Mutate;
  onHandleDown: (entry: PicklistCollabEntryWithRating, event: PointerEvent<HTMLButtonElement>) => void;
  onHandleMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onHandleUp: () => void;
  onHandleCancel: () => void;
  onHandleKey: (entry: PicklistCollabEntryWithRating, event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const [weight, setWeight] = useState("1");
  const [rank, setRank] = useState("");
  return (
    <li className={`picklist-collab-entry${dragged ? " is-dragging" : ""}`} data-entry-id={entry.id}>
      <button
        type="button"
        className="picklist-drag-handle"
        data-handle={entry.id}
        aria-label={`Move team ${entry.teamNumber}: drag, or press the up and down arrow keys`}
        disabled={busy && !dragged}
        onPointerDown={(event) => onHandleDown(entry, event)}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleCancel}
        onKeyDown={(event) => onHandleKey(entry, event)}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <div className="picklist-entry-main">
        <strong>
          #{entry.teamNumber}
          {entry.teamName ? ` — ${entry.teamName}` : ""}
        </strong>
        <small className="app-muted picklist-collab-tip">
          {picklistEntrySummary({
            sliderRank,
            sliderCount,
            votes: entry.votes.length,
            weightedScore: entry.weightedScore,
            averageRankSuggestion: entry.averageRankSuggestion,
            role: entry.epaRole ? epaRoleLabel(entry.epaRole) : null,
          })}
        </small>
        {entry.note ? <small className="app-muted">{entry.note}</small> : null}
      </div>
      <div className="picklist-collab-entry-actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => mutate({ action: "cast-vote", entryId: entry.id, weight: 1 })}
        >
          Vote
        </Button>
        <details className="picklist-row-more">
          <summary aria-label={`More for team ${entry.teamNumber}`}>More</summary>
          <div className="picklist-row-more-panel">
            <label>
              Tier
              <select
                value={entry.tier}
                onChange={(event) =>
                  mutate({ action: "move-entry", entryId: entry.id, tier: event.target.value, position: 1 })
                }
              >
                {PICKLIST_COLLAB_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {picklistCollabTierLabel(tier)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Vote weight
              <input type="number" min={0.1} max={5} step={0.1} value={weight} onChange={(event) => setWeight(event.target.value)} />
            </label>
            <label>
              Suggested place
              <input type="number" min={1} placeholder="Optional" value={rank} onChange={(event) => setRank(event.target.value)} />
            </label>
            <div className="picklist-row-more-actions">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  mutate({
                    action: "cast-vote",
                    entryId: entry.id,
                    weight: Number(weight) || 1,
                    rankSuggestion: rank ? Number(rank) : undefined,
                  })
                }
              >
                Vote with these
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove team #${entry.teamNumber} from this list?`)) {
                    mutate({ action: "delete-entry", entryId: entry.id });
                  }
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        </details>
      </div>
    </li>
  );
}
