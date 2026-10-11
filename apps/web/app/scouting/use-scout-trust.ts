"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { qualityEvidenceSchema } from "../../lib/scouting/quality-evidence";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import type { TrustSnapshot } from "./scouting-model";

/**
 * Optional field-quality hints for the scout form. They belong to one team and
 * event: a snapshot loaded for another scope is never shown, and a request that
 * cannot confirm its scope leaves the hints absent.
 */
export function useScoutTrust(orgId: string, activeEventKey: string | null | undefined) {
  const [trustContext, setTrust] = useState<{ orgId: string; eventKey: string; snapshot: TrustSnapshot } | null>(null);
  const trust = trustContext && trustContext.orgId === orgId && trustContext.eventKey === activeEventKey ? trustContext.snapshot : null;
  const trustGeneration = useRef(0);
  const trustAbort = useRef<AbortController | null>(null);
  const trustMounted = useRef(true);
  useEffect(() => { trustMounted.current = true; return () => { trustMounted.current = false; ++trustGeneration.current; trustAbort.current?.abort(); }; }, []);
  const loadTrust = useCallback(async (eventKey: string | null | undefined) => {
    if (!trustMounted.current) return;
    trustAbort.current?.abort();
    const generation = ++trustGeneration.current;
    setTrust(null);
    if (!orgId || !eventKey || !navigator.onLine) return;
    const controller = new AbortController(); trustAbort.current = controller;
    try {
      const params = new URLSearchParams({ orgId, eventKey });
      const response = await fetch(`/api/scouting/trust?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]) });
      const raw: unknown = await response.json().catch(() => null);
      if (generation !== trustGeneration.current) return;
      if (!response.ok) return;
      const body = qualityEvidenceSchema.safeParse(raw);
      if (!body.success || body.data.orgId !== orgId || body.data.eventKey !== eventKey) return;
      setTrust({ orgId, eventKey, snapshot: { fieldTrust: body.data.fieldTrust, fieldTrustBySchema: body.data.fieldTrustBySchema, leaderboard: body.data.leaderboard } });
    } catch {
      /* Optional hints stay absent when their current scope cannot be confirmed. */
    }
  }, [orgId]);
  return { trust, loadTrust };
}
