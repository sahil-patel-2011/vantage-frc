"use client";

import { useState } from "react";
import { Button, Panel } from "../../components/ui";
import { EVENT_DAY_PACK, saveEventDayPack } from "../../lib/offline/event-day-pack";
import { warmOfflineRoutes } from "../../lib/offline/warm-routes";
import { withOrgHref } from "../../lib/nav/product-nav";

/**
 * One tap before the venue, for the pit crew and drive team — the Vantage twin of
 * Scouting's "Get this phone ready". Saves Event Day, My Day, the schedule, Pit, the
 * match checklist and the packing list where each page reads its offline copy, and has
 * the service worker keep the pages. The note says only what was actually saved.
 */
export function SaveEventDayPanel({ orgId }: { orgId: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function saveAll() {
    setBusy(true);
    try {
      try {
        await navigator.storage?.persist?.();
      } catch {
        // Not every browser offers it.
      }
      const { saved, failed } = await saveEventDayPack(orgId, {
        onProgress: (done, total) => setNote(`Saving… ${done} of ${total}`),
      });
      const warmed = await warmOfflineRoutes(EVENT_DAY_PACK.map((item) => withOrgHref(item.route, orgId)));
      const list = (items: string[]) =>
        items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : (items[0] ?? "");
      if (saved.length === 0) {
        setNote("Nothing could be saved. Check the connection and try again.");
        return;
      }
      const pages =
        warmed && warmed.pages > 0
          ? ` The pages themselves are kept too (${warmed.pages}).`
          : " Open each page once while online so the page itself is kept as well.";
      const missed = failed.length ? ` Could not save ${list(failed)}.` : "";
      setNote(`Saved ${list(saved)} on this phone.${pages}${missed}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel aria-label="Save event day on this phone" className="offline-shell-save">
      <div>
        <h2 className="offline-shell-panel-title">Save event day on this phone</h2>
        <p className="app-muted" role="status">
          {note ??
            "Before you lose signal at the venue: Event Day, My Day, the schedule, Pit, the match checklist and the packing list, kept on this device."}
        </p>
      </div>
      <Button variant="primary" type="button" disabled={busy} onClick={() => void saveAll()}>
        {busy ? "Saving…" : note ? "Save again" : "Save event day"}
      </Button>
    </Panel>
  );
}
