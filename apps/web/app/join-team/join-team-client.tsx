"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { VantageLogo } from "../../components/brand";
import { Button, FormRow } from "../../components/ui";
import { teamJoinInvitePath } from "../../lib/onboarding/entry-journey";
import {
  joinCodeDigits,
  joinCodeHint,
  joinFailureMessage,
  teamJoinNextStep,
  teamNumberDigits,
  type TeamJoinMember,
} from "../../lib/team/join-code-flow";
import { signOutAndRedirect } from "../../lib/sign-out";
import { probeSessionUser } from "../../lib/nav/session-probe";
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
  const [sessionChecked, setSessionChecked] = useState(false);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [alreadyOn, setAlreadyOn] = useState<TeamJoinMember | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Fragments prefill the form without putting a shared code in server URLs.
    const invitation = new URLSearchParams(window.location.hash.slice(1));
    const invitedTeam = teamNumberDigits(invitation.get("team") ?? "");
    const invitedPin = joinCodeDigits(invitation.get("code") ?? "");
    if (/^[0-9]{1,5}$/.test(invitedTeam) && Number(invitedTeam) > 0 && invitedPin.length === 6) {
      setTeam(invitedTeam); setPin(invitedPin);
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
    // Shared with the consent banner: one session check per page.
    void probeSessionUser().then((user) => {
      if (cancelled) return;
      if (user?.email && user.emailVerified) { setEmail(user.email); setSessionEmail(user.email); }
      setSessionFailed(user === undefined);
      setSessionChecked(true);
    }).catch(() => { if (!cancelled) { setSessionChecked(true); setSessionFailed(true); } });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!sessionEmail || submitting.current || !/^[0-9]{1,5}$/.test(team) || Number(team) < 1 || pin.length !== 6) return;
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
        const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        setError(joinFailureMessage(response.status, body));
        return;
      }
      const data = (await response.json()) as Record<string, unknown>;
      const next = teamJoinNextStep(data, { signedIn: Boolean(sessionEmail), validInvitePath: teamJoinInvitePath });
      if (next.kind === "member") {
        setAlreadyOn(next.member);
        return;
      }
      if (next.kind === "error") throw new Error("Invitation handoff was not confirmed");
      // Signed out: straight to sign-in for this invitation (the email and "You're joining Team
      // N" come with it), not an invitation page whose only step is "Sign in to accept".
      window.location.assign(next.href);
    } catch {
      setError("Could not connect. Your details are still here. Try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (alreadyOn) {
    const team = alreadyOn.orgName?.trim() || `Team ${alreadyOn.teamNumber}`;
    return (
      <main className="join-team-page">
        <section className="join-team-card" aria-labelledby="join-team-title">
          <VantageLogo />
          <h1 id="join-team-title" tabIndex={-1}>You&rsquo;re already on {team}</h1>
          <p className="app-muted">
            No new invitation needed: this account is a member of {team} already.
          </p>
          <Button as="a" variant="primary" href={alreadyOn.href}>Open Home</Button>
          <p className="join-team-alternative">
            Joining a different team? <button type="button" className="join-team-link" onClick={() => { setAlreadyOn(null); setTeam(""); setPin(""); }}>Enter another code</button>
          </p>
        </section>
      </main>
    );
  }
  if (!sessionEmail) return (
    <main className="join-team-page"><section className="join-team-card" aria-labelledby="join-team-title">
      <VantageLogo /><h1 id="join-team-title">{sessionFailed ? "Couldn’t check your account" : sessionChecked ? "Start with your email" : "Checking your account…"}</h1>
      <p className="app-muted">{sessionFailed ? "Check your connection and try again. Your team code hasn’t been submitted." : "Verify your email, then enter your team’s six-digit join code."}</p>
      {sessionFailed ? <Button variant="primary" onClick={() => window.location.reload()}>Try again</Button> : sessionChecked ? <Button as="a" variant="primary" href="/signin?next=%2Fjoin-team">Continue with email</Button> : null}
    </section></main>
  );
  return (
    <main className="join-team-page">
      <section className="join-team-card" aria-labelledby="join-team-title">
        <VantageLogo />
        <h1 id="join-team-title">Join your team</h1>
        <p className="app-muted">
          Your email is verified. Enter your team’s six-digit code to join. Your team’s owner and mentors
          see who joined and choose what you can do.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          {/* No maxLength on either field: the browser cut a pasted "206 436" to "206 43" before
              the spaces were dropped. Digits are kept from whatever is pasted, then trimmed. */}
          <FormRow label="FRC team number">
            <input
              required
              inputMode="numeric"
              autoComplete="off"
              disabled={busy}
              value={team}
              onChange={(event) => setTeam(teamNumberDigits(event.target.value))}
              placeholder="e.g. 6925"
            />
          </FormRow>
          <FormRow
            label="Team join code"
            hint={
              <span id="join-team-code-hint" aria-live="polite">
                {joinCodeHint(pin) ?? "Spaces and dashes are fine. Your team admin can tell you the code."}
              </span>
            }
          >
            <input
              required
              inputMode="numeric"
              autoComplete="off"
              disabled={busy}
              value={pin}
              aria-describedby="join-team-code-hint"
              onChange={(event) => setPin(joinCodeDigits(event.target.value))}
              placeholder="Six numbers"
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
