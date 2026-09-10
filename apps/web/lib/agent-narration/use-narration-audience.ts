"use client";

import { useEffect, useState } from "react";
import { FEATURE_API_TIMEOUT_MS } from "../nav/resolve-org";

/**
 * Who is reading the narration. Students get the reasoning open by default (teach visibly);
 * mentors get it collapsed so it never fights the work they came to do.
 */
export type NarrationAudience = "student" | "mentor";

/** One in-flight /api/me read shared by every WhyPanel on the page. */
let cached: Promise<NarrationAudience> | null = null;

const STORAGE_KEY = "vantage.narration.audience";

/** Synchronous first paint for repeat mounts, so the panel does not expand then collapse. */
function readStored(): NarrationAudience {
  if (typeof window === "undefined") return "student";
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return stored === "mentor" ? "mentor" : "student";
  } catch {
    return "student";
  }
}

function writeStored(value: NarrationAudience) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage unavailable (private mode / embedded shell) — the fetch still works. */
  }
}

function classify(teamRole: unknown): NarrationAudience {
  const role = typeof teamRole === "string" ? teamRole.trim().toLowerCase() : "";
  // Only the two roles that actually mean "experienced adult" collapse the panel.
  return role === "mentor" || role === "coach" ? "mentor" : "student";
}

async function loadAudience(): Promise<NarrationAudience> {
  try {
    const response = await fetch("/api/me", {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    if (!response.ok) return "student";
    const data = (await response.json()) as { teamRole?: string | null };
    const audience = classify(data.teamRole);
    writeStored(audience);
    return audience;
  } catch {
    // Unknown viewer defaults to teaching — the product principle, not a guess about them.
    return "student";
  }
}

/**
 * Resolve the reading audience from the signed-in profile's team role.
 * Defaults to "student" until known, so nobody ever loses the explanation to a slow fetch.
 */
export function useNarrationAudience(enabled = true): NarrationAudience {
  // Server render and first client paint must agree, so start neutral and hydrate from storage.
  const [audience, setAudience] = useState<NarrationAudience>("student");

  useEffect(() => {
    if (!enabled) return;
    setAudience(readStored());
    let active = true;
    cached ??= loadAudience();
    void cached.then((value) => {
      if (active) setAudience(value);
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  return audience;
}

/** Exported for tests / callers that already hold a profile row. */
export const narrationAudienceForTeamRole = classify;
