"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ANALYTICS_SOURCE,
  parseAnalyticsSource,
  parseEventKeyList,
  parseTeamKeyList,
  serializeAnalyticsSource,
  type AnalyticsSourceMode,
  type AnalyticsSourceSettings,
} from "./lovat-data-source";
import { FEATURE_API_TIMEOUT_MS } from "../nav/resolve-org";

export function useAnalyticsSource(orgId: string | null): {
  settings: AnalyticsSourceSettings;
  busy: boolean;
  setMode: (mode: AnalyticsSourceMode) => void;
  setTeams: (raw: string) => void;
  setEvents: (raw: string) => void;
} {
  const [settings, setSettings] = useState<AnalyticsSourceSettings>(DEFAULT_ANALYTICS_SOURCE);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void fetch(`/api/team/analytics-source?orgId=${encodeURIComponent(orgId)}`, {
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    })
      .then(async (response) => {
        const data = (await response.json()) as { settings?: unknown };
        if (!cancelled) setSettings(parseAnalyticsSource(data.settings));
      })
      .catch(() => {
        if (!cancelled) setSettings(DEFAULT_ANALYTICS_SOURCE);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const persist = useCallback(
    async (next: AnalyticsSourceSettings) => {
      const serialized = serializeAnalyticsSource(next);
      setSettings(serialized);
      if (!orgId) return;
      setBusy(true);
      try {
        await fetch("/api/team/analytics-source", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          body: JSON.stringify({ orgId, ...serialized }),
        });
      } catch {
        // Ranking still uses the in-memory picker for this session.
      } finally {
        setBusy(false);
      }
    },
    [orgId],
  );

  return {
    settings,
    busy,
    setMode: (mode) => void persist({ ...settings, mode }),
    setTeams: (raw) => void persist({ ...settings, teamKeys: parseTeamKeyList(raw) }),
    setEvents: (raw) => void persist({ ...settings, eventKeys: parseEventKeyList(raw) }),
  };
}
