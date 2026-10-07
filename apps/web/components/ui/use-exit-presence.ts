"use client";
import { useEffect, useState } from "react";

/** Retain only the visual shell on close; callers immediately release focus and input. */
export function useExitPresence(open: boolean, duration = 150) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setPresent(false); return; }
    const timer = window.setTimeout(() => setPresent(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration]);
  return { present: open || present, closing: !open };
}
