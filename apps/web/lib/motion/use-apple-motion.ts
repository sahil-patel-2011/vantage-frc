"use client";

import { useEffect, useState } from "react";
import {
  motionClassNames,
  motionLevelFromPreference,
  motionStyleVars,
  motionTokens,
  parsePrefersReducedMotion,
  staggerDelayMs,
  type MotionLevel,
  type MotionTokens,
} from "./apple-motion";

function readPreference(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useAppleMotion(): {
  level: MotionLevel;
  tokens: MotionTokens;
  classNames: ReturnType<typeof motionClassNames>;
  styleVars: Record<string, string>;
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

  const level = motionLevelFromPreference(reduced || parsePrefersReducedMotion(reduced ? "reduce" : "no-preference"));
  const tokens = motionTokens(level);

  useEffect(() => {
    const root = document.documentElement;
    const vars = motionStyleVars(tokens);
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
    root.dataset.motion = level;
    return () => {
      root.removeAttribute("data-motion");
    };
  }, [level, tokens]);

  return {
    level,
    tokens,
    classNames: motionClassNames(level),
    styleVars: motionStyleVars(tokens),
    stagger: (index: number) => staggerDelayMs(index, level),
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
