"use client";

import { useEffect, useRef } from "react";
import { nextCadLivePollDelayMs, shouldPollCadLiveSession } from "../../lib/cad/cad-live-poll";
import type { AgentState, CadBusy } from "./cad-model";

/** While "Working in Onshape…", re-read checkpointed steps before POST returns. */
export function useCadLivePoll(input: {
  orgId: string;
  busy: CadBusy;
  apply: (incoming: AgentState) => void;
}) {
  const applyRef = useRef(input.apply);
  applyRef.current = input.apply;

  useEffect(() => {
    if (!shouldPollCadLiveSession(input.busy)) return;
    let cancelled = false;
    let failures = 0;
    let timer = 0;
    const tick = async () => {
      try {
        const response = await fetch(`/api/cad/agent?orgId=${encodeURIComponent(input.orgId)}`);
        if (cancelled) return;
        if (!response.ok) {
          failures += 1;
        } else {
          failures = 0;
          const data = (await response.json()) as AgentState;
          if (!cancelled) applyRef.current(data);
        }
      } catch {
        if (!cancelled) failures += 1;
      }
      if (!cancelled) {
        timer = window.setTimeout(() => {
          void tick();
        }, nextCadLivePollDelayMs(failures));
      }
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [input.orgId, input.busy]);
}
