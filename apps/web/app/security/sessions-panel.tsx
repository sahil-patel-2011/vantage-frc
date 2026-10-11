"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, Panel, askConfirm } from "../../components/ui";
import type { SessionView } from "../../lib/account/sessions";

type Load = { state: "loading" } | { state: "ready"; sessions: SessionView[] } | { state: "error"; message: string };

function when(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";
}

function readSessions(data: unknown): SessionView[] | null {
  if (!data || typeof data !== "object" || !Array.isArray((data as { sessions?: unknown }).sessions)) return null;
  return (data as { sessions: SessionView[] }).sessions;
}

function errorOf(data: unknown, fallback: string): string {
  const error = data && typeof data === "object" ? (data as { error?: unknown }).error : null;
  return typeof error === "string" && error ? error : fallback;
}

/**
 * Where you're signed in (QA A1-10). A lost phone, or a laptop left at an event, stayed signed in
 * for up to a week; now each other session can be ended here, or all of them at once.
 */
export function SessionsPanel() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const response = await fetch("/api/account/sessions", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const data: unknown = await response.json().catch(() => null);
      const sessions = response.ok ? readSessions(data) : null;
      setLoad(sessions ? { state: "ready", sessions } : { state: "error", message: errorOf(data, "Couldn't load where you're signed in.") });
    } catch {
      setLoad({ state: "error", message: "Couldn't reach Vantage. Check your connection and try again." });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function end(body: { action: "revoke-others" } | { action: "revoke"; id: string }, done: string) {
    setBusy(true);
    setNote("");
    try {
      const response = await fetch("/api/account/sessions", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: unknown = await response.json().catch(() => null);
      const sessions = response.ok ? readSessions(data) : null;
      if (sessions) {
        setLoad({ state: "ready", sessions });
        setNote(done);
      } else {
        setNote(errorOf(data, "Couldn't sign that session out. Try again."));
      }
    } catch {
      setNote("Couldn't reach Vantage, so nothing was signed out. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const others = load.state === "ready" ? load.sessions.filter((session) => !session.current) : [];

  return (
    <Panel as="article" aria-busy={load.state === "loading" || undefined}>
      <h2>Where you&rsquo;re signed in</h2>
      <p>Lost a phone, or left a laptop signed in at the shop or an event? Sign it out here.</p>
      {load.state === "loading" ? <p className="app-muted">Loading your sessions…</p> : null}
      {load.state === "error" ? (
        <EmptyState soft title="Couldn't load your sessions" description={load.message}>
          <Button type="button" onClick={() => void refresh()}>Try again</Button>
        </EmptyState>
      ) : null}
      {load.state === "ready"
        ? load.sessions.map((session) => (
            <div className="saved-board" key={session.id}>
              <div>
                <strong>{session.current ? `${session.device} (this device)` : session.device}</strong>
                <small>
                  Signed in {when(session.signedInAt)}
                  {session.current ? "" : ` · last active ${when(session.lastActiveAt)}`}
                </small>
              </div>
              {session.current ? null : (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: `Sign out ${session.device}?`,
                      body: "Anyone using that session will have to sign in again. Nothing else changes.",
                      confirmLabel: "Sign it out",
                      tone: "neutral",
                    });
                    if (ok) await end({ action: "revoke", id: session.id }, `${session.device} is signed out.`);
                  }}
                >
                  Sign out
                </Button>
              )}
            </div>
          ))
        : null}
      {load.state === "ready" && others.length === 0 ? (
        <p className="app-muted">You&rsquo;re only signed in here.</p>
      ) : null}
      {others.length > 1 ? (
        <Button
          type="button"
          disabled={busy}
          onClick={async () => {
            const ok = await askConfirm({
              title: `Sign out ${others.length} other sessions?`,
              body: "Every other phone, tablet and computer signed in to your account will have to sign in again. This one stays signed in.",
              confirmLabel: `Sign out ${others.length} others`,
              tone: "neutral",
            });
            if (ok) await end({ action: "revoke-others" }, "Every other session is signed out.");
          }}
        >
          Sign out all other sessions
        </Button>
      ) : null}
      {note ? <p role="status">{note}</p> : null}
    </Panel>
  );
}
