"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";

type Recovery = { email: string; verified: boolean } | null;

/**
 * Recovery email: a second inbox that can sign you in if you lose the main one
 * (/api/account/recovery-email). An address only counts after its code is typed back.
 */
export function RecoveryEmailSettings({ suggested }: { suggested?: string }) {
  const [recovery, setRecovery] = useState<Recovery | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(suggested ?? "");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/recovery-email", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { recovery?: Recovery; available?: boolean; error?: string };
      if (response.ok) {
        setRecovery(data.recovery ?? null);
        setAvailable(data.available !== false);
      }
      else {
        setRecovery(null);
        if (data.error) setMessage({ ok: false, text: data.error });
      }
    } catch {
      setRecovery(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(method: "POST" | "DELETE", body?: Record<string, string>) {
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/account/recovery-email", {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; email?: string };
      return response.ok && data.ok ? { ok: true as const, email: data.email } : { ok: false as const, error: data.error };
    } catch {
      return { ok: false as const, error: "We couldn't reach Vantage. Check your connection." };
    } finally {
      setWorking(false);
    }
  }

  async function sendCode() {
    const result = await call("POST", { action: "send", email: email.trim() });
    if (result.ok) {
      setSentTo(result.email ?? email.trim().toLowerCase());
      setCode("");
      setMessage({ ok: true, text: "Check that inbox for a 6-digit code." });
    } else setMessage({ ok: false, text: result.error ?? "We couldn't send a code. Try again." });
  }

  async function confirm() {
    const result = await call("POST", { action: "confirm", code: code.trim() });
    if (result.ok) {
      setSentTo(null);
      setEditing(false);
      setMessage({ ok: true, text: "Recovery email saved." });
      void load();
    } else setMessage({ ok: false, text: result.error ?? "That code didn't work." });
  }

  async function remove() {
    const result = await call("DELETE");
    if (result.ok) {
      setMessage({ ok: true, text: "Recovery email removed." });
      setEmail("");
      void load();
    } else setMessage({ ok: false, text: result.error ?? "Couldn't remove it. Try again." });
  }

  const saved = recovery?.verified ? recovery : null;
  const showForm = available && (editing || (!saved && recovery !== undefined));

  return (
    <div className="account-recovery" aria-live="polite">
      <span className="account-recovery-label">Recovery email</span>
      {recovery === undefined ? (
        <p className="app-muted">Loading…</p>
      ) : saved && !editing ? (
        <div className="account-recovery-row">
          <span>{saved.email}</span>
          <Button variant="ghost" size="sm" type="button" disabled={working} onClick={() => setEditing(true)}>
            Change
          </Button>
          <Button variant="ghost" size="sm" type="button" disabled={working} onClick={() => void remove()}>
            Remove
          </Button>
        </div>
      ) : null}
      {!available && !saved && recovery !== undefined ? (
        <p className="app-muted">Available once Vantage can send email. Nothing for you to do yet.</p>
      ) : null}
      {showForm ? (
        sentTo ? (
          <div className="account-recovery-row">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              aria-label={`Code sent to ${sentTo}`}
              placeholder="6-digit code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(event) => {
                // Inside the profile form: Enter confirms the code instead of saving the profile.
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (code.length === 6 && !working) void confirm();
              }}
            />
            <Button variant="primary" size="sm" type="button" disabled={working || code.length !== 6} onClick={() => void confirm()}>
              {working ? "Checking…" : "Confirm"}
            </Button>
            <Button variant="ghost" size="sm" type="button" disabled={working} onClick={() => setSentTo(null)}>
              Back
            </Button>
          </div>
        ) : (
          <div className="account-recovery-row">
            <input
              type="email"
              autoComplete="email"
              aria-label="Recovery email"
              placeholder="A second inbox you can always open"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (email.includes("@") && !working) void sendCode();
              }}
            />
            <Button variant="secondary" size="sm" type="button" disabled={working || !email.includes("@")} onClick={() => void sendCode()}>
              {working ? "Sending…" : "Send code"}
            </Button>
            {editing ? (
              <Button variant="ghost" size="sm" type="button" disabled={working} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        )
      ) : null}
      <small className="app-muted">
        If you ever can&apos;t get into your main email, sign in with a code sent here. We&apos;ll email you whenever it changes.
      </small>
      {message ? (
        <p className={message.ok ? "account-recovery-ok" : "account-recovery-error"} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
