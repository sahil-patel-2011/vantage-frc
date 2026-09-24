"use client";

import { teamNumberOf } from "../../lib/scouting/scout-context";
import type { SaveReceipt } from "./scouting-model";

/**
 * "Saved 1323 · Qual 10 ✓  Next: Qual 11 · 254 · Red 2"
 *
 * Save used to clear the form without a word near where the scout was
 * looking; the only sign was "Synced 1 entries and 0 media files" under the
 * button, in the same amber as an error. This sits at the top of the form,
 * green, over the robot tiles for the next match, and stays until the next
 * save or until it is dismissed. "Next" is only named when an assignment or
 * the schedule names it.
 */
export function ScoutSaveConfirmation({
  receipt,
  onDismiss,
}: {
  receipt: SaveReceipt;
  onDismiss: () => void;
}) {
  const saved = [
    receipt.entryType === "pit" ? `pit report for ${teamNumberOf(receipt.teamKey)}` : teamNumberOf(receipt.teamKey),
    receipt.matchLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const next = receipt.next
    ? [receipt.next.matchLabel, receipt.next.teamNumber, receipt.next.stationLabel].filter(Boolean).join(" · ")
    : null;
  const detail = receipt.offline
    ? "Kept on this phone. It uploads by itself when there is signal."
    : receipt.next?.teamNumber
      ? "The next robot is picked below. Tap a different one if you are watching someone else."
      : receipt.next
        ? "Pick the robot you are watching in the next match."
        : null;

  return (
    <div id="scout-save-confirmation" className="scout-saved" role="status">
      <p className="scout-saved-line">
        <strong>
          Saved {saved} <span aria-hidden="true">✓</span>
        </strong>
        {next ? <span className="scout-saved-next">Next: {next}</span> : null}
      </p>
      {detail ? <p className="scout-saved-detail">{detail}</p> : null}
      <button type="button" className="scout-saved-dismiss" onClick={onDismiss} aria-label="Dismiss saved message">
        ×
      </button>
    </div>
  );
}
