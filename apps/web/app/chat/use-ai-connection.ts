"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AiConnection = { configured: boolean; reason: string | null; message?: string | null };

const CHECK_FAILED: AiConnection = {
  configured: false,
  reason: "check_unavailable",
  message: "Couldn't check your AI connection. Retry before sending; your question stays here.",
};
const UNREACHABLE: AiConnection = {
  configured: false,
  reason: "check_unavailable",
  message: "Couldn't reach Vantage to check AI. Retry before sending; your question stays here.",
};

/**
 * Whether AI can answer for this team, checked beside the chat list rather than inside it.
 * The check walks the whole provider ladder (~30 queries); when it rode on the chat list's
 * request the chats and composer waited for it. Now they paint at once, and "Connect AI"
 * shows above the box before anyone presses Send. `null` means still checking.
 */
export function useAiConnection(orgId: string) {
  const [connection, setConnection] = useState<AiConnection | null>(null);
  const request = useRef<AbortController | null>(null);

  const recheck = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setConnection(null);
    if (!orgId) return;
    try {
      const response = await fetch(`/api/agent?${new URLSearchParams({ orgId, part: "connection" })}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as { aiConnection?: AiConnection | null };
      if (controller.signal.aborted) return;
      setConnection(response.ok && "aiConnection" in data ? (data.aiConnection ?? null) : CHECK_FAILED);
    } catch {
      if (!controller.signal.aborted) setConnection(UNREACHABLE);
    }
  }, [orgId]);

  useEffect(() => {
    void recheck();
    return () => request.current?.abort();
  }, [recheck]);

  return { connection, setConnection, recheck };
}
