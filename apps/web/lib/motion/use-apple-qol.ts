"use client";

import { useEffect, useState } from "react";
import {
  parseQolReduced,
  qolClassNames,
  qolLevelFromPreference,
  qolStaggerMs,
  qolStyleVars,
  qolTokens,
  type QolLevel,
  type QolTokens,
} from "./apple-qol";

function readPreference(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useAppleQol(): {
  level: QolLevel;
  tokens: QolTokens;
  styleVars: Record<string, string>;
  classNames: ReturnType<typeof qolClassNames>;
  stagger: (index: number) => number;
} {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  const level = qolLevelFromPreference(reduced || parseQolReduced(reduced ? "reduce" : "no-preference"));
  const tokens = qolTokens(level);

  useEffect(() => {
    const next = qolTokens(level);
    const root = document.documentElement;
    const vars = qolStyleVars(next);
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
    if (level === "reduce") root.dataset.qol = "reduce";
    else delete root.dataset.qol;
    return () => {
      delete root.dataset.qol;
    };
  }, [level]);

  return {
    level,
    tokens,
    styleVars: qolStyleVars(tokens),
    classNames: qolClassNames(level),
    stagger: (index) => qolStaggerMs(index, level),
  };
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(readPreference());
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return reduced;
}
