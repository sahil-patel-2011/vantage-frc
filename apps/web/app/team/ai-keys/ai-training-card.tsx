"use client";

import { useEffect, useState } from "react";

type Choice = { available: boolean; trainingAllowed: boolean; canManage: boolean };

/**
 * "Let Vantage learn from our AI activity": the team's switch for the training use described in
 * the Privacy Policy. Owners and admins change it; everyone else sees what the team chose.
 */
export function AiTrainingCard({ orgId }: { orgId: string | null }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void fetch(`/api/organizations/ai-training?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Choice>) : null))
      .then((data) => {
        if (!cancelled && data) setChoice(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!orgId || !choice?.available) return null;

  async function save(next: boolean) {
    if (!orgId || busy) return;
    setBusy(true);
    setNote(null);
    // The switch moves at once; it moves back if the save fails.
    setChoice((current) => (current ? { ...current, trainingAllowed: next } : current));
    try {
      const response = await fetch("/api/organizations/ai-training", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, trainingAllowed: next }),
      });
      const data = (await response.json().catch(() => ({}))) as { trainingAllowed?: boolean; error?: string };
      if (!response.ok) {
        setChoice((current) => (current ? { ...current, trainingAllowed: !next } : current));
        setNote({ ok: false, text: data.error ?? "Could not save this setting." });
        return;
      }
      setChoice((current) => (current ? { ...current, trainingAllowed: data.trainingAllowed ?? next } : current));
      setNote({
        ok: true,
        text: next
          ? "Saved. Vantage may learn from your team's AI activity."
          : "Saved. None of your team's AI activity will be used to train Vantage's models.",
      });
    } catch {
      setChoice((current) => (current ? { ...current, trainingAllowed: !next } : current));
      setNote({ ok: false, text: "Could not reach Vantage. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="app-card soft-panel ai-training-card" aria-labelledby="ai-training-title">
      <h2 id="ai-training-title">Model training</h2>
      <p className="app-muted">
        Vantage may use your team&rsquo;s AI activity (questions, the context sent with them and the answers) to
        improve its own models. It is never sold or shared with advertisers.{" "}
        <a href="/privacy#ai">How AI features use your data</a>
      </p>
      {choice.canManage ? (
        <label className="ai-training-switch">
          <input
            type="checkbox"
            role="switch"
            checked={choice.trainingAllowed}
            aria-busy={busy}
            onChange={(event) => void save(event.target.checked)}
          />
          <span>
            <strong>Let Vantage learn from our AI activity</strong>
            <small>
              {choice.trainingAllowed
                ? "On. Turn it off and none of your team's AI activity is used for training."
                : "Off. None of your team's AI activity is used for training."}
            </small>
          </span>
        </label>
      ) : (
        <p>
          <strong>{choice.trainingAllowed ? "On for this team." : "Off for this team."}</strong>{" "}
          <span className="app-muted">An owner or admin can change it.</span>
        </p>
      )}
      {note ? (
        <p role={note.ok ? "status" : "alert"} className={`ai-training-note${note.ok ? " ok" : ""}`}>
          {note.text}
        </p>
      ) : null}
    </section>
  );
}
