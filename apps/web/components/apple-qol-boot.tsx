"use client";

import { useAppleQol } from "../lib/motion/use-apple-qol";

/** Syncs prefers-reduced-motion onto html so apple-qol.css can no-op. */
export function AppleQolBoot() {
  useAppleQol();
  return null;
}
