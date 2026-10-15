"use client";

import { anySignal } from "../../lib/abort/any-signal";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatConnectionNextStep, ChatConnectionState } from "../../lib/ai/chat-send-gate";

/** Same shape the server's check and a refused send return (`lib/ai/chat-send-gate.ts`). */
export type AiConnection = ChatConnectionState;

const CHECK_FAILED: AiConnection = {
  configured: false,
  reason: "check_unavailable",
  message: "Couldn't check your AI connection. Retry before sending; your question stays here.",
  nextStep: "retry",
};
const UNREACHABLE: AiConnection = {
  configured: false,
  reason: "check_unavailable",
  message: "Couldn't reach Vantage to check AI. Retry before sending; your question stays here.",
  nextStep: "retry",
};

/**
 * The one action the composer offers when AI can't answer. An older server sends no `nextStep`;
 * fall back on the reason it does send.
 */
export function connectionNextStep(connection: AiConnection): ChatConnectionNextStep {
  if (connection.nextStep) return connection.nextStep;
  if (connection.reason === "check_unavailable") return "retry";
  if (connection.reason === "usage_cap" || connection.reason === "provider_unavailable") return "settings";
  if (connection.reason?.startsWith("missing_context:")) return "none";
  return "connect";
}

/**
 * A send refused with `setup_required`: the server's connection state when it sent one, else a
 * not-configured state from its message. Never "configured", so Send stays off for the session.
 */
export function refusedConnection(data: { aiConnection?: unknown; message?: unknown; error?: unknown }): AiConnection {
  const sent = data.aiConnection as AiConnection | null | undefined;
  if (sent && typeof sent === "object" && sent.configured === false) return sent;
  const message = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : null;
  return { configured: false, reason: "provider_unavailable", message, nextStep: "settings" };
}

/** What the composer says when no message came with the state. */
export function connectionMessage(connection: AiConnection): string {
  if (connection.message) return connection.message;
  return connection.reason === "no_model_provider"
    ? "AI isn't connected for this team yet."
    : "Your AI connection isn't available. Check its settings.";
}

const cacheKey = (orgId: string) => `vantage-ai-connection:${orgId}`;

/**
 * The last check that said AI works for this team, kept on this device. Only a working answer is
 * kept: Send is enabled from it at once (the server still refuses a send that can't run, and that
 * refusal replaces it), while a "not connected" answer always comes fresh from the check.
 */
function readWorkingConnection(orgId: string): AiConnection | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(orgId));
    const parsed = raw ? (JSON.parse(raw) as AiConnection) : null;
    return parsed && parsed.configured === true ? parsed : null;
  } catch {
    return null;
  }
}

function rememberConnection(orgId: string, connection: AiConnection | null) {
  try {
    if (connection?.configured === true) window.localStorage.setItem(cacheKey(orgId), JSON.stringify(connection));
    else window.localStorage.removeItem(cacheKey(orgId));
  } catch {
    /* Private mode: the check still runs every time. */
  }
}

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
    // A recheck starts from what this device last knew worked for this team instead of blanking
    // to "Checking your AI connection…" on every visit, team switch and Retry.
    setConnection(orgId ? readWorkingConnection(orgId) : null);
    if (!orgId) return;
    try {
      const response = await fetch(`/api/agent?${new URLSearchParams({ orgId, part: "connection" })}`, {
        signal: anySignal([controller.signal, AbortSignal.timeout(15_000)]),
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as { aiConnection?: AiConnection | null };
      if (controller.signal.aborted) return;
      if (response.ok && "aiConnection" in data) {
        const next = data.aiConnection ?? null;
        rememberConnection(orgId, next);
        setConnection(next);
        return;
      }
      // A failed check doesn't undo a known-working connection; the send itself will say.
      setConnection((current) => (current?.configured === true ? current : CHECK_FAILED));
    } catch {
      if (!controller.signal.aborted) setConnection((current) => (current?.configured === true ? current : UNREACHABLE));
    }
  }, [orgId]);

  useEffect(() => {
    void recheck();
    return () => request.current?.abort();
  }, [recheck]);

  return { connection, setConnection, recheck };
}
