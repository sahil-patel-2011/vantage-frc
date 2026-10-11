"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { VantageLogo } from "../../components/brand";
import { Button, FormRow } from "../../components/ui";
import { teamJoinInvitePath } from "../../lib/onboarding/entry-journey";
import { teamJoinNextStep, type TeamJoinMember } from "../../lib/team/join-code-flow";
import { apiErrorMessage } from "../../lib/ui/load-failure";
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
  const [alreadyOn, setAlreadyOn] = useState<TeamJoinMember | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Shared with the consent banner: one session check per page.
    void probeSessionUser().then((user) => {
      if (cancelled || !user?.email) return;
      setEmail(user.email);
      setSessionEmail(user.email);
    });
    return () => {
      cancelled = true;
    };
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
