"use client";

import { useEffect, useState } from "react";

/** Scout disagreements for the active event, and the coach's review of them. */
export function useScoutConflicts({ orgId, eventKey, active, setMessage }: {
  orgId: string;
  eventKey: string | null | undefined;
  /** The Conflicts task is open (a task switch or a notification deep link). */
  active: boolean;
  setMessage: (message: string) => void;
}) {
  const [conflicts, setConflicts] = useState<Array<Record<string, unknown>>>([]);
  const [selectedWinners, setSelectedWinners] = useState<Record<string, string>>({});

  // Fetch disagreements for both task switches and notification deep links.
  const conflictsEventKey = eventKey ?? "";
  useEffect(() => {
    if (!active || !orgId || !conflictsEventKey) return;
    let cancelled = false;
    void fetch(
      `/api/scouting/disagreements?orgId=${encodeURIComponent(orgId)}&eventKey=${encodeURIComponent(conflictsEventKey)}`,
    )
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { disagreements: [] };
        if (!cancelled) setConflicts(body.disagreements);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, orgId, conflictsEventKey]);

  async function loadConflicts() {
    if (!eventKey) return;
    const response = await fetch(
      `/api/scouting/disagreements?orgId=${encodeURIComponent(orgId)}&eventKey=${encodeURIComponent(eventKey ?? "")}`,
    );
    if (response.ok) setConflicts(((await response.json()) as { disagreements: [] }).disagreements);
  }

  async function reviewConflict(id: string, status: "resolved" | "dismissed") {
    if (status === "resolved" && !selectedWinners[id]) {
      setMessage("Pick which scout was right before resolving — that updates pick-desk trust.");
      return;
    }
    const response = await fetch("/api/scouting/disagreements", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        id,
        status,
        winningEntryId: status === "resolved" ? selectedWinners[id] : undefined,
        resolution: { reviewedIn: "scouting-ui" },
      }),
    });
    if (response.ok) {
      setSelectedWinners((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await loadConflicts();
      setMessage(
        status === "resolved"
          ? "Resolved · pick-desk trust updated · coordinators notified"
          : "Dismissed · coordinators notified",
      );
    } else setMessage("Coach role is required to review conflicts");
  }

  return { conflicts, selectedWinners, setSelectedWinners, loadConflicts, reviewConflict };
}
