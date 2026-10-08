"use client";
import { useEffect } from "react";

/** Refresh when a committed queue write, another tab or returning focus changes
 * this person's reports. Idle scouting should not scan storage or poll /api/me. */
export function useScoutQueueRefresh(refresh: () => Promise<void>): void {
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== "hidden") void refresh().catch(() => undefined);
    };
    update();
    window.addEventListener("focus", update);
    window.addEventListener("vantage-scout-storage-change", update);
    const storageChanged = (event: StorageEvent) => { if (event.key === "vantage-scout-storage-change") update(); };
    window.addEventListener("storage", storageChanged);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("vantage-scout-storage-change", update);
      window.removeEventListener("storage", storageChanged);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
}
