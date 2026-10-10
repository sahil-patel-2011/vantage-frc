"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Modal, Panel } from "../../components/ui";
import { useTierDrag } from "../../components/ui/use-tier-drag";
import "../../components/ui/tier-drag.css";
import { PICKLIST_COLLAB_TIERS, epaRoleLabel, picklistCollabTierLabel, picklistEntrySummary, type PicklistCollabEntryWithRating } from "../../lib/picklist-collab";
import { orderPayload, reorderGroups, type TierGroup } from "../../lib/picklist-collab/reorder";
import type { PicklistCollabTier } from "../../lib/picklist-collab/types";
import type { CollabMutate } from "../../lib/picklist-collab/view-contract";
import { useDiscussionDraft, type ReportDiscussionDraft } from "./use-discussion-draft";

export function PicklistTierList({ groups, sliderRank, sliderCount, busy, mutate, onReordered, canManage, canVote, currentUserId, error, reportDraft }: {
  groups: TierGroup[]; sliderRank: Map<string, number>; sliderCount: number; busy: boolean;
  mutate: CollabMutate; onReordered: () => void; canManage: boolean; canVote: boolean; currentUserId?: string; error?: string;
  reportDraft: ReportDiscussionDraft;
}) {
  const [pending, setPending] = useState<TierGroup[] | null>(null);
  const [removing, setRemoving] = useState<PicklistCollabEntryWithRating | null>(null);
  const shown = pending ?? groups;
  const { rootRef, drag, announcement, handleProps, slotIndex } = useTierDrag<PicklistCollabTier>({
    groups: shown.map(group => ({ tier: group.tier, ids: group.entries.map(entry => entry.id) })),
    enabled: canManage && !busy && pending === null,
    tierLabel: picklistCollabTierLabel,
    onMove: (id, tier, index) => {
      const next = reorderGroups(shown, id, tier, index);
      setPending(next);
      void mutate(orderPayload(next)).then(saved => { if (saved) onReordered(); }).finally(() => setPending(null));
    },
  });
  return (
    <div ref={rootRef} id="picklist-collab-entries" className="picklist-collab-layout">
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {shown.map(({ tier, entries }) => {
        if (!entries.length) return null;
        const slot = slotIndex(tier);
        const rows: ReactNode[] = []; let stay = 0;
        for (const entry of entries) {
          const dragged = drag?.id === entry.id;
          if (!dragged && slot === stay) rows.push(<li key="drop-slot" className="tier-drop-slot" aria-hidden="true" />);
          if (!dragged) stay++;
          rows.push(<EntryRow key={entry.id} entry={entry} busy={busy || pending !== null} dragged={dragged}
            sliderRank={sliderRank.get(`frc${entry.teamNumber}`) ?? null} sliderCount={sliderCount} mutate={mutate}
            canManage={canManage} canVote={canVote} currentUserId={currentUserId} handleProps={handleProps(entry.id, tier)} onRemove={() => setRemoving(entry)} reportDraft={reportDraft} />);
        }
        if (slot !== null && stay <= slot) rows.push(<li key="drop-slot" className="tier-drop-slot" aria-hidden="true" />);
        return <Panel key={tier} className="picklist-collab-panel"><h2 style={{ marginTop: 0 }}>{picklistCollabTierLabel(tier)}</h2><ul className="picklist-collab-list" data-tier-list={tier}>{rows}</ul></Panel>;
      })}
      <Modal open={removing !== null} onClose={() => { if (!busy) setRemoving(null); }} title={`Remove team ${removing?.teamNumber ?? ""}?`}>
        <p>Removing this team also removes its pick-list votes and discussion. A team on the draft board must first be cleared from its board slot.</p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="app-actions"><Button type="button" variant="primary" disabled={busy} onClick={() => setRemoving(null)}>Keep team</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={async () => { if (removing && await mutate({ action: "delete-entry", entryId: removing.id })) setRemoving(null); }}>{busy ? "Removing…" : "Remove team"}</Button></div>
      </Modal>
    </div>
  );
}

function EntryRow({ entry, busy, dragged, sliderRank, sliderCount, mutate, handleProps, canManage, canVote, currentUserId, onRemove, reportDraft }: {
  entry: PicklistCollabEntryWithRating; busy: boolean; dragged: boolean; sliderRank: number | null; sliderCount: number;
  mutate: CollabMutate; canManage: boolean; canVote: boolean; currentUserId?: string; onRemove: () => void;
  reportDraft: ReportDiscussionDraft;
  handleProps: ReturnType<ReturnType<typeof useTierDrag<PicklistCollabTier>>["handleProps"]>;
}) {
  const mine = entry.votes.find(vote => vote.voterId === currentUserId);
  const [weight, setWeight] = useState(String(mine?.weight ?? 1));
  const [rank, setRank] = useState(mine?.rankSuggestion == null ? "" : String(mine.rankSuggestion));
  const [comment, setComment] = useState(mine?.comment ?? "");
  const [voteError, setVoteError] = useState("");
  const [note, setNote] = useState(entry.note ?? "");
  const [noteError, setNoteError] = useState("");
  const noteEdited = useRef(false);
  useDiscussionDraft(`note:${entry.id}`, note !== (entry.note ?? ""), reportDraft);
  useEffect(() => { if (!noteEdited.current) setNote(entry.note ?? ""); }, [entry.note]);
  const edited = useRef(false);
  useDiscussionDraft(entry.id, weight !== String(mine?.weight ?? 1) || rank !== (mine?.rankSuggestion == null ? "" : String(mine.rankSuggestion)) || comment !== (mine?.comment ?? ""), reportDraft);
  useEffect(() => {
    if (edited.current) return;
    setWeight(String(mine?.weight ?? 1)); setRank(mine?.rankSuggestion == null ? "" : String(mine.rankSuggestion)); setComment(mine?.comment ?? "");
  }, [mine?.weight, mine?.rankSuggestion, mine?.comment]);
  const validWeight = weight.trim() !== "" && Number.isFinite(Number(weight)) && Number(weight) >= .1 && Number(weight) <= 5;
  const validRank = !rank || (Number.isSafeInteger(Number(rank)) && Number(rank) >= 1 && Number(rank) <= 500);
  return (
    <li className={`picklist-collab-entry${dragged ? " is-dragging" : ""}${canManage ? "" : " read-only-ranking"}`} data-entry-id={entry.id}>
      {canManage ? <button type="button" className="tier-drag-handle" disabled={busy && !dragged}
        aria-label={`Move team ${entry.teamNumber}: drag, or press the up and down arrow keys`} {...handleProps}><span aria-hidden="true">⋮⋮</span></button> : null}
      <div className="picklist-entry-main">
        <strong>#{entry.teamNumber}{entry.teamName ? ` · ${entry.teamName}` : ""}</strong>
        <small className="app-muted picklist-collab-tip">{picklistEntrySummary({ sliderRank, sliderCount, votes: entry.votes.length, weightedScore: entry.weightedScore,
          averageRankSuggestion: entry.averageRankSuggestion, role: entry.epaRole ? epaRoleLabel(entry.epaRole) : null })}</small>
        {entry.note ? <small className="app-muted">{entry.note}</small> : null}
        {entry.votes.length ? <details className="picklist-discussion"><summary>Team discussion · {entry.votes.length} vote{entry.votes.length === 1 ? "" : "s"}</summary>
          <ul>{entry.votes.map(vote => <li key={vote.id}><strong>{vote.voterId === currentUserId ? "You" : vote.voterName ?? "Team member"}</strong>
            <small>Weight {vote.weight}{vote.rankSuggestion == null ? "" : ` · suggested place ${vote.rankSuggestion}`}</small>{vote.comment ? <p>{vote.comment}</p> : null}</li>)}</ul>
        </details> : null}
      </div>
      <div className="picklist-collab-entry-actions">
        {canVote ? <details className="tier-row-more picklist-vote"><summary>{mine ? "Your vote" : "Add vote"}</summary>
          <form className="tier-row-more-panel" onSubmit={async event => {
            event.preventDefault(); if (busy || !validWeight || !validRank) return;
            const saved = await mutate({ action: "cast-vote", entryId: entry.id, weight: Number(weight), rankSuggestion: rank ? Number(rank) : undefined, comment: comment.trim() || undefined });
            if (saved) { edited.current = false; setWeight(String(Number(weight))); setRank(rank ? String(Number(rank)) : ""); setComment(comment.trim()); setVoteError(""); } else setVoteError("Vote not confirmed. Your answers are still here; check the page message before retrying.");
          }}>
            <label>Confidence weight<input type="number" min={.1} max={5} step={.1} disabled={busy} value={weight} onChange={event => { edited.current = true; setWeight(event.target.value); }} required /></label>
            <label>Suggested place<input type="number" min={1} max={500} step={1} disabled={busy} value={rank} placeholder="Optional" onChange={event => { edited.current = true; setRank(event.target.value); }} /></label>
            <label>Reason<textarea rows={3} maxLength={1000} disabled={busy} value={comment} placeholder="What did you observe?" onChange={event => { edited.current = true; setComment(event.target.value); }} /></label>
            <small>One vote per member. Saving updates your existing vote.</small>
            {voteError ? <p role="alert">{voteError}</p> : null}
            <Button type="submit" variant="primary" disabled={busy || !validWeight || !validRank}>{busy ? "Saving…" : mine ? "Update vote" : "Save vote"}</Button>
            {mine ? <Button type="button" variant="ghost" disabled={busy} onClick={async () => {
              const saved = await mutate({ action: "remove-vote", entryId: entry.id });
              if (saved) { edited.current = false; setWeight("1"); setRank(""); setComment(""); setVoteError(""); }
              else setVoteError("Removal not confirmed. Refresh the saved list to check before retrying.");
            }}>Remove my vote</Button> : null}
          </form>
        </details> : null}
        {canManage ? <details className="tier-row-more"><summary aria-label={`Manage team ${entry.teamNumber}`}>Manage</summary>
          <div className="tier-row-more-panel"><label>Move to tier<select disabled={busy} value={entry.tier} onChange={event => void mutate({ action: "move-entry", entryId: entry.id, tier: event.target.value, position: 1 })}>
            {PICKLIST_COLLAB_TIERS.map(tier => <option key={tier} value={tier}>{picklistCollabTierLabel(tier)}</option>)}</select></label>
            <form className="picklist-note-form" onSubmit={async event => {
              event.preventDefault(); if (busy) return;
              if (await mutate({ action: "set-entry-notes", entryId: entry.id, note: note.trim() || null })) { noteEdited.current = false; setNote(note.trim()); setNoteError(""); }
              else setNoteError("Note not confirmed. Your text is still here; refresh before retrying.");
            }}><label>Team note<textarea rows={3} maxLength={2000} disabled={busy} value={note} onChange={event => { noteEdited.current = true; setNote(event.target.value); }} /></label>
              {noteError ? <p role="alert">{noteError}</p> : null}<Button type="submit" variant="secondary" disabled={busy || note === (entry.note ?? "")}>Save note</Button>
            </form>
            <Button type="button" variant="ghost" disabled={busy} onClick={onRemove}>Remove team</Button></div>
        </details> : null}
      </div>
    </li>
  );
}
