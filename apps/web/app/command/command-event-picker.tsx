"use client";

import { useState } from "react";
import { Modal } from "../../components/ui";
import { CompetitionEventPlanner } from "../../components/competition-event-planner";

export type EventListState = "loading" | "failed" | "ready";
export function emptyEventListCopy(state: EventListState, year: number, searching: boolean): string {
  if (state === "loading") return "Loading this season's events…";
  if (state === "failed") return "We couldn't load the event list.";
  if (searching) return "No event matches that search. Try part of the name or the city, or add it below.";
  return `No ${year} events are listed yet. Published offseason events and your team's own events belong here too. Add it below.`;
}

export function CommandEventPicker({ open, orgId, onClose, onChanged, onActive }: {
  open: boolean; orgId: string; onClose: () => void;
  onChanged: () => void; onActive: (eventKey: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  return <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="Competition events" className="competition-event-dialog">
    {open && orgId ? <CompetitionEventPlanner key={orgId} orgId={orgId} onBusy={setBusy} onChanged={onChanged} onActive={onActive} /> : null}
  </Modal>;
}
