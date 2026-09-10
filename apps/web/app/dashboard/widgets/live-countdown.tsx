"use client";

import { useEffect, useState } from "react";

export function countdownLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "—";
  if (ms <= 0) return "Now";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const countdownListeners = new Set<() => void>();
let countdownTimer: number | null = null;

function startSharedCountdown() {
  if (countdownTimer !== null || typeof window === "undefined") return;
  countdownTimer = window.setInterval(() => {
    for (const listener of countdownListeners) listener();
  }, 1000);
}

function stopSharedCountdown() {
  if (countdownListeners.size > 0 || countdownTimer === null || typeof window === "undefined") return;
  window.clearInterval(countdownTimer);
  countdownTimer = null;
}

/** Tick once per second so countdownLabel stays live (next match, leave times, etc.). */
export function useCountdownTick(active = true) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const listener = () => setTick((n) => n + 1);
    countdownListeners.add(listener);
    startSharedCountdown();
    return () => {
      countdownListeners.delete(listener);
      stopSharedCountdown();
    };
  }, [active]);
}

export function LiveCountdown({ iso }: { iso: string | null | undefined }) {
  useCountdownTick(Boolean(iso));
  return <>{countdownLabel(iso)}</>;
}
