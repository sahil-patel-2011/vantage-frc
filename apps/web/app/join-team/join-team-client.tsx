"use client";
import { useEffect, useState, type FormEvent } from "react";
import { VantageLogo } from "../../components/brand";
import { Button, FormRow } from "../../components/ui";
import "./join-team.css";

export default function JoinTeamClient() {
  const [team, setTeam] = useState(""),
    [pin, setPin] = useState(""),
    [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/get-session", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((session) => {
        if (session?.user?.email && !controller.signal.aborted)
          setEmail((current) => current || session.user.email);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/teams/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamNumber: Number(team), pin, email }),
      });
      const data = await response.json();
      if (!response.ok || !data.href) {
        setError(
          data.error || "Could not join. Check the details and try again.",
        );
        return;
      }
      window.location.assign(data.href);
    } catch {
      setError("Could not connect. Your details are still here. Try again.");
    } finally {
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
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormRow>
          {error ? (
            <p role="alert" className="join-team-error">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            disabled={busy || pin.length !== 6 || !team || !email}
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
