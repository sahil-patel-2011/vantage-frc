"use client";

import { useEffect, useState } from "react";
import { Button, ConfirmDialog, Modal } from "../../components/ui";
import { useExitPresence } from "../../components/ui/use-exit-presence";
import type { PicklistCollabEntry } from "../../lib/picklist-collab/types";

export type PicklistDraftChange = (key: string, dirty: boolean) => void;

/** One vote per member and robot; saved feedback and the editor share its entry ID. */
export function PicklistVoteDialog({ entry, removed, userId, busy, mutate, onClose, onDraftChange, onRefresh }: {
  entry: PicklistCollabEntry;
  removed: boolean;
  userId: string | null;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
  onDraftChange?: PicklistDraftChange;
  onRefresh: () => void;
}) {
  const mine = entry.votes.find(vote => vote.voterId === userId);
  const [open, setOpen] = useState(true);
  const presence = useExitPresence(open);
  useEffect(() => { if (!open && !presence.present) onClose(); }, [open, presence.present, onClose]);
  const [comment, setComment] = useState(mine?.comment ?? "");
  const [weight, setWeight] = useState(String(mine?.weight ?? 1));
  const [rank, setRank] = useState(mine?.rankSuggestion == null ? "" : String(mine.rankSuggestion));
  const [confirmation, setConfirmation] = useState<"close" | "withdraw" | null>(null);
  const [result, setResult] = useState("");
  const numericWeight = Number(weight);
  const numericRank = rank.trim() ? Number(rank) : null;
  const valid = weight.trim() !== "" && Number.isFinite(numericWeight) && numericWeight >= 0.1 && numericWeight <= 5 &&
    (numericRank === null || (Number.isSafeInteger(numericRank) && numericRank > 0));
  const dirty = comment.trim() !== (mine?.comment ?? "") || numericWeight !== (mine?.weight ?? 1) || numericRank !== (mine?.rankSuggestion ?? null);
  useEffect(() => { onDraftChange?.("vote", dirty); }, [dirty, onDraftChange]);
  useEffect(() => () => onDraftChange?.("vote", false), [onDraftChange]);

  const close = () => {
    if (busy) return;
    if (dirty) setConfirmation("close");
    else setOpen(false);
  };
  const save = async () => {
    if (busy || !valid || !userId || removed) return;
    setResult("");
    const saved = await mutate({ action: "cast-vote", entryId: entry.id, weight: numericWeight, rankSuggestion: numericRank, comment: comment.trim() || null });
    setResult(saved ? "Your vote and feedback are saved." : "Your vote could not be confirmed. Your feedback is still here; check the shared list before retrying.");
  };

  return <>
    <Modal open={open} title={`Team ${entry.teamNumber} discussion`} onClose={close}>
      <div className="picklist-discussion">
        {removed ? <p role="alert">This robot was removed from the list. The feedback below is its last loaded copy. Copy any unsaved feedback before closing.</p> : null}
        {entry.note ? <p className="picklist-discussion-note"><strong>Team note</strong>{entry.note}</p> : null}
        <section aria-label="Saved team feedback">
          <div className="picklist-feedback-heading"><h3>Team feedback <span className="app-muted">({entry.votes.length})</span></h3><Button variant="ghost" disabled={busy} onClick={onRefresh}>Refresh feedback</Button></div>
          {entry.votes.length ? <ul className="picklist-feedback-list">{entry.votes.map(vote => <li key={vote.id}>
            <div><strong>{vote.voterId === userId ? "You" : vote.voterName?.trim() || "Team member"}</strong><span className="app-muted">Weight {vote.weight}{vote.rankSuggestion == null ? "" : ` · Suggested place ${vote.rankSuggestion}`}</span></div>
            {vote.comment ? <p>{vote.comment}</p> : <p className="app-muted">Voted without a comment.</p>}
          </li>)}</ul> : <p className="app-muted">No votes yet. Share what you observed and why this robot fits your alliance.</p>}
        </section>
        <form className="picklist-vote-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <h3>{mine ? "Your vote" : "Add your vote"}</h3>
          <label>Reason or observation<textarea rows={4} maxLength={1000} value={comment} disabled={busy || !userId} onChange={event => { setComment(event.target.value); setResult(""); }} placeholder="What did you see? How would this robot help your alliance?" /></label>
          <details className="picklist-vote-options"><summary>Vote weight and suggested place</summary><div>
            <label>Vote weight<input type="number" min="0.1" max="5" step="0.1" required value={weight} disabled={busy || !userId} onChange={event => { setWeight(event.target.value); setResult(""); }} /></label>
            <label>Suggested place<input type="number" min="1" step="1" value={rank} disabled={busy || !userId} onChange={event => { setRank(event.target.value); setResult(""); }} placeholder="Optional" /></label>
          </div><p className="app-muted">Weight changes your contribution to the vote total. Suggested place is feedback; it does not move the shared ranking.</p></details>
          {!userId ? <p role="status">Reconnect to verify your identity before voting.</p> : !valid ? <p role="status">Use a weight from 0.1 to 5 and a whole positive place, or leave place blank.</p> : null}
          {result ? <p role="status">{result}</p> : null}
          <div className="picklist-vote-actions"><Button type="button" variant="secondary" disabled={busy} onClick={close}>Close</Button><Button type="submit" variant="primary" disabled={busy || removed || !valid || !userId || Boolean(mine && !dirty)}>{busy ? "Please wait…" : mine ? dirty ? "Save changes" : "Saved" : "Save vote"}</Button></div>
          {mine && !removed ? <div className="picklist-vote-withdraw"><Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmation("withdraw")}>Withdraw my vote</Button></div> : null}
        </form>
      </div>
    </Modal>
    <ConfirmDialog open={confirmation !== null} opts={confirmation === "withdraw" ? {
      title: "Withdraw your vote?", body: `This removes your vote and comment for team ${entry.teamNumber}. Other teammates' feedback and the shared ranking remain.`, confirmLabel: "Withdraw my vote",
    } : { title: "Discard unsaved feedback?", body: `Your unsaved feedback for team ${entry.teamNumber} will be discarded. Your last saved vote remains.`, confirmLabel: "Discard and close", cancelLabel: "Keep editing" }} onResolve={ok => {
      const action = confirmation; setConfirmation(null);
      if (!ok) return;
      if (action === "close") setOpen(false);
      else void mutate({ action: "remove-vote", entryId: entry.id }).then(saved => {
        if (saved) { setComment(""); setWeight("1"); setRank(""); setResult("Your vote was withdrawn."); }
        else setResult("Withdrawal could not be confirmed. Your feedback is still here.");
      });
    }} />
  </>;
}
