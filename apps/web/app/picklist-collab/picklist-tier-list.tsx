"use client";

import { useState, type ReactNode } from "react";
import { Button, Panel, ConfirmDialog } from "../../components/ui";
import { useTierDrag } from "../../components/ui/use-tier-drag";
import "../../components/ui/tier-drag.css";
import {
  PICKLIST_COLLAB_TIERS,
  epaRoleLabel,
  picklistCollabTierLabel,
  picklistEntrySummary,
  type PicklistCollabEntryWithRating,
} from "../../lib/picklist-collab";
import { orderPayload, reorderGroups, type TierGroup } from "../../lib/picklist-collab/reorder";
import type { PicklistCollabTier } from "../../lib/picklist-collab/types";
import { PicklistVoteDialog, type PicklistDraftChange } from "./picklist-vote-dialog";

type Mutate = (payload: Record<string, unknown>) => Promise<boolean>;

/** The team lists, one panel per tier. Drag a handle (finger, mouse) or use the arrow keys. */
export function PicklistTierList({
  groups,
  sliderRank,
  sliderCount,
  busy,
  rankingLocked = false,
  mutate,
  onReordered,
  userId,
  onDraftChange,
  onRefresh,
}: {
  groups: TierGroup[];
  /** team key ("frc254") to place in "Ranked by your sliders". */
  sliderRank: Map<string, number>;
  sliderCount: number;
  busy: boolean;
  rankingLocked?: boolean;
  mutate: Mutate;
  /** Called once a new order is sent, so the page can switch to "My order". */
  onReordered: () => void;
  userId: string | null;
  onDraftChange?: PicklistDraftChange;
  onRefresh: () => void;
}) {
  // The dropped order shows at once and stays until the saved copy arrives; without it the list
  // re-sorted by the old positions for a moment and jumped twice.
  const [pending, setPending] = useState<TierGroup[] | null>(null);
  const [selectedDiscussion, setSelectedDiscussion] = useState<PicklistCollabEntryWithRating | null>(null);
  const currentDiscussion = groups.flatMap(group => group.entries).find(entry => entry.id === selectedDiscussion?.id);
  const discussion = currentDiscussion ?? selectedDiscussion;
  const shown = pending ?? groups;
  const { rootRef, drag, announcement, handleProps, slotIndex } = useTierDrag<PicklistCollabTier>({
    groups: shown.map((group) => ({ tier: group.tier, ids: group.entries.map((entry) => entry.id) })),
    enabled: !busy && !rankingLocked && pending === null,
    tierLabel: picklistCollabTierLabel,
    onMove: (id, tier, index) => {
      const next = reorderGroups(shown, id, tier, index);
      setPending(next);
      void mutate(orderPayload(next)).then(saved => {
        if (saved) onReordered();
      }).finally(() => {
        setPending(null);
      });
    },
  });

  return (
    <div ref={rootRef} id="picklist-collab-entries" className="picklist-collab-layout">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {shown.map(({ tier, entries }) => {
        // Empty tiers stay hidden, also while dragging: revealing them shifts the page under the
        // pointer. A team goes to an empty tier from its "More" menu.
        if (entries.length === 0) return null;
        const slot = slotIndex(tier);
        const rows: ReactNode[] = [];
        let stay = 0;
        for (const entry of entries) {
          const isDragged = drag?.id === entry.id;
          if (!isDragged && slot === stay) rows.push(<li key="drop-slot" className="tier-drop-slot" aria-hidden="true" />);
          if (!isDragged) stay += 1;
          rows.push(
            <EntryRow
              key={entry.id}
              entry={entry}
              busy={busy}
              rankingLocked={rankingLocked}
              dragged={isDragged}
              sliderRank={sliderRank.get(`frc${entry.teamNumber}`) ?? null}
              sliderCount={sliderCount}
              mutate={mutate}
              handleProps={handleProps(entry.id, tier)}
              onDiscuss={() => setSelectedDiscussion(entry)}
            />,
          );
        }
        if (slot !== null && stay <= slot) rows.push(<li key="drop-slot" className="tier-drop-slot" aria-hidden="true" />);
        return (
          <Panel key={tier} className="picklist-collab-panel">
            <h2 style={{ marginTop: 0 }}>{picklistCollabTierLabel(tier)}</h2>
            <ul className="picklist-collab-list" data-tier-list={tier}>
              {rows}
            </ul>
          </Panel>
        );
      })}
      {discussion ? <PicklistVoteDialog key={discussion.id} entry={discussion} removed={!currentDiscussion} userId={userId} busy={busy} mutate={mutate} onClose={() => setSelectedDiscussion(null)} onDraftChange={onDraftChange} onRefresh={onRefresh} /> : null}
    </div>
  );
}

function EntryRow({
  entry,
  busy,
  rankingLocked,
  dragged,
  sliderRank,
  sliderCount,
  mutate,
  handleProps,
  onDiscuss,
}: {
  entry: PicklistCollabEntryWithRating;
  busy: boolean;
  rankingLocked: boolean;
  dragged: boolean;
  sliderRank: number | null;
  sliderCount: number;
  mutate: Mutate;
  handleProps: ReturnType<ReturnType<typeof useTierDrag<PicklistCollabTier>>["handleProps"]>;
  onDiscuss: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <li className={`picklist-collab-entry${dragged ? " is-dragging" : ""}`} data-entry-id={entry.id}>
      <button
        type="button"
        className="tier-drag-handle"
        aria-label={`Move team ${entry.teamNumber}: drag, or press the up and down arrow keys`}
        aria-disabled={rankingLocked || (busy && !dragged) || undefined}
        {...handleProps}
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
          aria-label={`Discuss team ${entry.teamNumber}`}
          onClick={onDiscuss}
        >
          Discuss{entry.votes.length ? ` (${entry.votes.length})` : ""}
        </Button>
        <details className="tier-row-more">
          <summary aria-label={`More for team ${entry.teamNumber}`}>More</summary>
          <div className="tier-row-more-panel">
            <label>
              Tier
              <select
                disabled={busy || rankingLocked}
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
            <div className="tier-row-more-actions">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || rankingLocked}
                onClick={() => setConfirmRemove(true)}
              >
                Remove
              </Button>
            </div>
          </div>
        </details>
      </div>
      <ConfirmDialog open={confirmRemove} opts={{ title: `Remove team ${entry.teamNumber}?`, body: "This removes the team and its votes from this pick list. Scouting reports remain available.", confirmLabel: "Remove team" }} onResolve={ok => { setConfirmRemove(false); if (ok) void mutate({ action: "delete-entry", entryId: entry.id }); }} />
    </li>
  );
}
