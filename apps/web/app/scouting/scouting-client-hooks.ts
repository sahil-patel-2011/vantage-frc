"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { syncMediaOutbox, syncOutbox } from "../../lib/scout-offline";
import { syncSummary } from "../../lib/scouting/scout-context";
import type { OfficialFlag } from "./scouting-model";

/** The address the server rendered, then the live address after hydration. No suspense gate. */
export function useLocationQuery(initialSearch: string) {
  const [search, setSearch] = useState(initialSearch.replace(/^\?/, ""));
  useEffect(() => {
    const apply = () => setSearch(window.location.search.replace(/^\?/, ""));
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** Send the on-device queue, then say what uploaded and what still needs a person. */
export function useScoutingOutboxSync(input: {
  orgId: string;
  refreshCounts: () => Promise<void>;
  refreshLive: () => Promise<void>;
  setSyncState: Dispatch<SetStateAction<"idle" | "syncing" | "degraded">>;
  setMessage: Dispatch<SetStateAction<string>>;
  setSyncNote: Dispatch<SetStateAction<string | null>>;
  setOfficialFlags: Dispatch<SetStateAction<OfficialFlag[]>>;
}) {
  const { orgId, refreshCounts, refreshLive, setSyncState, setMessage, setSyncNote, setOfficialFlags } = input;
  return useCallback(async () => {
    if (!orgId || !navigator.onLine) return;
    setSyncState("syncing");
    try {
      const entries = await syncOutbox(orgId, {
        onRetry: (_n, delayMs) => {
          setSyncState("degraded");
          setMessage(`Couldn't reach the team yet. Trying again in ${Math.round(delayMs / 1000)}s; your entries are safe on this phone.`);
        },
      });
      const media = await syncMediaOutbox(orgId);
      if (entries.validations.length) setOfficialFlags(entries.validations);
      const quarantinedNow = entries.quarantined + media.quarantined;
      const uploaded = syncSummary({ entries: entries.count, media: media.synced });
      const conflictCount = entries.validations.filter((flag) => flag.status === "conflict").length;
      const problems = [
        conflictCount
          ? `${conflictCount} official-score disagreement${conflictCount === 1 ? "" : "s"} flagged`
          : null,
        quarantinedNow ? `${quarantinedNow} need${quarantinedNow === 1 ? "s" : ""} attention below` : null,
      ].filter(Boolean);
      if (problems.length) {
        // Something to act on: this stays in the message line by the form.
        setMessage([uploaded, ...problems].filter(Boolean).join(" · "));
      } else if (uploaded) {
        // Plain good news goes beside the queue count, not under Save in the
        // colour the form uses for problems.
        setSyncNote(uploaded);
        // A retry notice from earlier in this sync is no longer true.
        setMessage((current) => (current.startsWith("Couldn't reach the team yet") ? "" : current));
      }
      // A sync that "finished" can still have left entries on this phone: say why.
      if (entries.failure === "signed-out") {
        setMessage("You are signed out, so nothing more was sent. Sign in again; your entries stay on this phone until then.");
      } else if (entries.failure) {
        setMessage("Couldn't reach the team yet, so some entries were not sent. They stay on this phone and send themselves later.");
      }
      setSyncState(entries.failure ? "degraded" : "idle");
      await refreshCounts();
      if (entries.count > 0) void refreshLive();
    } catch (error) {
      setSyncState(navigator.onLine ? "degraded" : "idle");
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Not sent yet. Your entries are saved on this phone and send when the signal is better.",
      );
    }
  }, [orgId, refreshCounts, refreshLive, setSyncState, setMessage, setSyncNote, setOfficialFlags]);
}
