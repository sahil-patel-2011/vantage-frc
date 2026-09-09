"use client";

import { useState } from "react";

import type { SchedulerPick } from "../../../lib/calendar-ai/pick";

/**
 * Ask for a time in a sentence, get back real slots with real reasons.
 *
 * The model never picks a date. It reads the request; every proposed time comes
 * from `proposeSlots`, computed from this team's own past sessions, RSVPs and
 * attendance, and checked against the calendar for conflicts. So the panel can
 * show WHY a slot is suggested, and the reason is something you can go and
 * check against your own history.
 *
 * When there is no history there are no proposals, and this says so rather than
 * offering three confident-looking times nothing supports.
 */

type Proposal = {
  startsAt: string;
  endsAt: string;
  weekdayName: string;
  reason: string | null;
  clear: boolean;
  conflictTitle?: string;
};

type Result = {
  title: string;
  kind: string;
  durationMinutes: number;
  subteamId: string | null;
  basis: string;
  proposals: Proposal[];
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AiScheduler({ onUse }: { onUse: (pick: SchedulerPick) => void }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    if (!ask.trim()) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/calendar/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: ask }),
      });
      const data = (await response.json()) as Result & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not work out a time.");
        return;
      }
      setResult(data);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="app-button secondary tc-ai-open" onClick={() => setOpen(true)}>
        Find a time
      </button>
    );
  }

  return (
    <section className="tc-ai" aria-label="Find a time">
      <header>
        <strong>Find a time</strong>
        <button type="button" className="tc-text-link" onClick={() => setOpen(false)}>
          Close
        </button>
      </header>

      <p className="app-muted">
        Describe it in a sentence. Times come from when your team has actually turned up, not from a guess.
      </p>

      <div className="tc-ai-row">
        <input
          value={ask}
          onChange={(event) => setAsk(event.target.value)}
          placeholder="a two hour build session next week for mechanical"
          maxLength={600}
          onKeyDown={(event) => {
            if (event.key === "Enter" && ask.trim() && !busy) void run();
          }}
        />
        <button type="button" className="app-button" disabled={busy || !ask.trim()} onClick={() => void run()}>
          {busy ? "Looking…" : "Suggest"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="tc-ai-error">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="tc-ai-out">
          <p className="tc-ai-basis">
            <strong>{result.title}</strong> · {result.durationMinutes} min · based on {result.basis}
          </p>

          {result.proposals.length === 0 ? (
            // The honest branch. Nothing is invented to fill this space.
            <p className="app-muted">
              No suggestion yet — there is not enough attendance history to say when your team turns up. Schedule a
              few sessions the normal way and this will start proposing times you can check.
            </p>
          ) : (
            <ul className="tc-ai-list">
              {result.proposals.map((p) => (
                <li key={p.startsAt} className={p.clear ? "tc-ai-slot" : "tc-ai-slot busy"}>
                  <div>
                    <strong>{when(p.startsAt)}</strong>
                    {p.reason ? (
                      <small className="app-muted">{p.reason}</small>
                    ) : (
                      <small className="app-muted">No attendance pattern behind this one — it is just a free slot.</small>
                    )}
                    {!p.clear ? (
                      <small className="tc-ai-clash">Clashes with {p.conflictTitle ?? "another event"}</small>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="app-button secondary"
                    onClick={() =>
                      onUse({
                        startsAt: p.startsAt,
                        endsAt: p.endsAt,
                        title: result.title,
                        kind: result.kind,
                        subteamId: result.subteamId,
                      })
                    }
                  >
                    Use this
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="tc-ai-fine app-muted">
            Nothing has been added to the calendar. Picking one fills in the new-event form so you can check it first.
          </p>
        </div>
      ) : null}
    </section>
  );
}
