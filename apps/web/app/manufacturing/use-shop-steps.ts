"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ShopStepsView } from "../../lib/manufacturing/steps-model";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { friendlyErrorMessage } from "../../lib/ui/friendly-error";

function isView(value: unknown): value is ShopStepsView {
  const status = (value as { status?: unknown } | null)?.status;
  return status === "live" || status === "setup_required";
}

/**
 * Loads one part's steps (the drawing QR page) or the shop queue (the kiosk), and sends changes.
 * `refreshMs` keeps a wall-mounted kiosk current; it pauses while the tab is hidden.
 */
export function useShopSteps(target: { partId: string } | { kiosk: true }, refreshMs?: number) {
  const [view, setView] = useState<ShopStepsView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const partId = "partId" in target ? target.partId : null;

  const load = useCallback(async () => {
    const orgId = new URLSearchParams(window.location.search).get("orgId") ?? "";
    const query = new URLSearchParams();
    if (orgId) query.set("orgId", orgId);
    if (partId) query.set("partId", partId);
    else query.set("kiosk", "1");
    try {
      const response = await fetch(`/api/manufacturing/steps?${query}`, { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) });
      const data = (await response.json().catch(() => null)) as ShopStepsView | { error?: string } | null;
      if (!response.ok || !isView(data)) {
        setProblem((data && "error" in data && data.error) || "Couldn't load the shop steps.");
        return;
      }
      setView(data);
      setProblem(null);
    } catch (error) {
      setProblem(friendlyErrorMessage(error, "Couldn't load the shop steps."));
    }
  }, [partId]);

  useEffect(() => {
    void load();
    if (!refreshMs) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busyRef.current) void load();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [load, refreshMs]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>): Promise<boolean> => {
      const orgId = view && view.orgId;
      if (!orgId || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      try {
        const response = await fetch("/api/manufacturing/steps", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload, ...(partId ? { viewPartId: partId } : { view: "kiosk" }) }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json().catch(() => null)) as ShopStepsView | { error?: string } | null;
        if (!response.ok || !isView(data)) {
          setProblem((data && "error" in data && data.error) || "That didn't save. Try again.");
          return false;
        }
        setView(data);
        setProblem(null);
        return true;
      } catch (error) {
        setProblem(friendlyErrorMessage(error, "That didn't save. Try again."));
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [view, partId],
  );

  return { view, problem, busy, load, mutate };
}
