"use client";

import { useEffect, useState } from "react";
import { DEFAULT_COCKPIT_PREFS, parseCockpitPrefs, type CockpitPrefs } from "./prefs";

/** Load the signed-in member's cockpit. Defaults until the request returns. */
export function useCockpitPrefs(): CockpitPrefs {
  const [prefs, setPrefs] = useState<CockpitPrefs>({ ...DEFAULT_COCKPIT_PREFS });

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account/cockpit", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { cockpit?: unknown } | null) => {
        if (cancelled || !data) return;
        setPrefs(parseCockpitPrefs(data.cockpit));
      })
      .catch(() => {
        /* keep defaults — never invent a stored cockpit */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return prefs;
}
