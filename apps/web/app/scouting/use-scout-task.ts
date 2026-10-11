"use client";

import { useState } from "react";
import type { ScoutTab } from "./scouting-model";

/**
 * User task switches start with a fresh robot; restored reports use setTab directly.
 * Scouting opens on pits: every team at the event needs a pit visit, and it can be done
 * before any match is played. A link to a match (?matchKey=, ?scoutTab=match) still opens
 * the match form, and a draft in progress reopens where it was.
 */
export function useScoutTask(resetTarget: () => void) {
  const [tab, setTab] = useState<ScoutTab>("pit");
  function onTabChange(id: string) {
    const next = id as ScoutTab;
    if ((next === "pit" || next === "match") && next !== tab) resetTarget();
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("scoutTab", next);
    url.searchParams.delete("matchKey");
    url.searchParams.delete("teamKey");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }
  return { tab, setTab, onTabChange };
}
