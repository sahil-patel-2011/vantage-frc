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
  // "24:18:25" had no unit and ticked every second a day out. Hours and days in words;
  // the ticking clock only in the last hour, when the seconds matter.
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rest = h % 24;
    return `${d} ${d === 1 ? "day" : "days"}${rest ? ` ${rest} hr` : ""}`;
  }
  if (h > 0) return `${h} hr ${m} min`;
  // With units, as on the TV: "35:56" read as a time of day. Seconds only in the last ten minutes.
  if (m >= 10) return `${m} min`;
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
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

/**
 * The clock beside a match. A match whose time has passed but that hasn't been played is
 * running late, not starting "Now": at 4:02 PM, "Starts in Now" for a 3:07 PM match read as
 * a mistake. Past the two-minute mark it says "Running late" and keeps the printed time.
 */
export function matchClock(iso: string | null | undefined, now = Date.now()): { label: string; value: string } {
  if (!iso) return { label: "Starts in", value: "Time not posted" };
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return { label: "Starts in", value: "Time not posted" };
  if (now - at > 2 * 60_000) {
    const time = new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return { label: `Scheduled ${time}`, value: "Running late" };
  }
  return { label: "Starts in", value: countdownLabel(iso) };
}

export function MatchClock({ iso, className }: { iso: string | null | undefined; className?: string }) {
  useCountdownTick(Boolean(iso));
  const clock = matchClock(iso);
  return (
    <div className={className}>
      {/* The server's clock and time zone are not the viewer's. */}
      <span suppressHydrationWarning>{clock.label}</span>
      <strong suppressHydrationWarning>{clock.value}</strong>
    </div>
  );
}

export function LiveCountdown({ iso }: { iso: string | null | undefined }) {
  useCountdownTick(Boolean(iso));
  return <>{countdownLabel(iso)}</>;
}
