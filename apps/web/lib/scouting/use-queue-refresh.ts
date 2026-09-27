"use client";
import { useEffect } from "react";

/** Another open scouting tab or the shell's background sync can change this
 * person's queue. Re-read local counts while visible and on returning focus. */
export function useScoutQueueRefresh(refresh: () => Promise<void>): void {
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== "hidden") void refresh().catch(() => undefined);
    };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    const timer = window.setInterval(update, 5_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
}
