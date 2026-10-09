"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { VantageLogo } from "../../components/brand";
import { Button, FormRow } from "../../components/ui";
import { teamJoinInvitePath } from "../../lib/onboarding/entry-journey";
import { apiErrorMessage } from "../../lib/ui/load-failure";
import { signOutAndRedirect } from "../../lib/sign-out";
import "./join-team.css";

export default function JoinTeamClient() {
  const [team, setTeam] = useState(""),
    [pin, setPin] = useState(""),
    [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/get-session", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) })
      .then((response) => (response.ok ? response.json() : null))
      .then((session) => {
        if (typeof session?.user?.email === "string" && !controller.signal.aborted) {
          setEmail(session.user.email);
          setSessionEmail(session.user.email);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !/^[0-9]{1,5}$/.test(team) || Number(team) < 1 || pin.length !== 6 || !email.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/teams/join", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamNumber: Number(team), pin, email: sessionEmail ?? email.trim() }),
      });
      if (!response.ok) {
        setError((await apiErrorMessage(response)) ?? "Could not join. Check the details and try again.");
        return;
      }
      const data = await response.json() as { href?: unknown };
      const href = teamJoinInvitePath(data.href);
      if (!href) throw new Error("Invitation handoff was not confirmed");
      window.location.assign(href);
    } catch {
      setError("Could not connect. Your details are still here. Try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="join-team-page">
      <section className="join-team-card" aria-labelledby="join-team-title">
        <VantageLogo />
        <h1 id="join-team-title">Join your team</h1>
        <p className="app-muted">
          Enter your team’s code, then verify your email to join.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <FormRow label="FRC team number">
            <input
              required
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{1,5}"
              maxLength={5}
              disabled={busy}
              value={team}
              onChange={(event) =>
                setTeam(event.target.value.replace(/\D/g, "").slice(0, 5))
              }
              placeholder="e.g. 6925"
            />
          </FormRow>
          <FormRow label="Team join code">
            <input
              required
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{6}"
              maxLength={6}
              disabled={busy}
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="Six numbers"
            />
          </FormRow>
          <FormRow label="Your email">
            <input
              required
              type="email"
              autoComplete="email"
              readOnly={Boolean(sessionEmail)}
              disabled={busy}
              aria-describedby={sessionEmail ? "join-team-identity" : undefined}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormRow>
          {sessionEmail ? <p className="join-team-identity" id="join-team-identity">Joining as {sessionEmail}. <button type="button" disabled={busy} onClick={async () => {
            if (submitting.current) return;
            submitting.current = true; setBusy(true);
            try { await signOutAndRedirect("/join-team"); }
            finally { submitting.current = false; setBusy(false); }
          }}>Use another account</button></p> : null}
          {error ? (
            <p ref={errorRef} tabIndex={-1} role="alert" className="join-team-error">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            disabled={busy || pin.length !== 6 || !team || Number(team) < 1 || !email.trim()}
          >
            {busy ? "Checking code…" : "Continue"}
          </Button>
        </form>
        <p className="join-team-alternative">
          Have an email invitation? <a href="/invite">Use your invitation</a>
        </p>
      </section>
    </main>
  );
}
