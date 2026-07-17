"use client";

import { useEffect, useState } from "react";
import type { AllianceBoardState } from "../../lib/strategy/pick-desk";

type Snapshot = {
  boardId: string;
  orgId: string;
  eventKey: string;
  eventName: string | null;
  name: string;
  state: AllianceBoardState;
  updatedAt: string;
  readOnly: true;
  expiresAt: string;
};

function teamNumber(teamKey: string | null) {
  if (!teamKey) return "—";
  return teamKey.replace(/^frc/, "");
}

export default function BoardClient() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("Missing share token.");
      return;
    }
    void fetch(`/api/strategy/draft/public?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data?.error) {
          setError(data.error ?? "Board unavailable");
          return;
        }
        setSnapshot(data as Snapshot);
      })
      .catch(() => setError("Could not load shared alliance board."));
  }, []);

  if (error) {
    return (
      <main className="module-page strategy-board-public">
        <section className="app-card">
          <h1>Alliance board</h1>
          <p className="app-muted">{error}</p>
        </section>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="module-page strategy-board-public">
        <section className="app-card">
          <h1>Loading mentor board…</h1>
        </section>
      </main>
    );
  }

  const state = snapshot.state;

  return (
    <main className="module-page strategy-board-public">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Vantage · Read-only mentor view</span>
          <h1>{snapshot.name}</h1>
          <p>
            {snapshot.eventName ?? snapshot.eventKey} · updated{" "}
            {new Date(snapshot.updatedAt).toLocaleString()} · link expires{" "}
            {new Date(snapshot.expiresAt).toLocaleString()}
          </p>
        </div>
        <span className="app-badge setup">Read only</span>
      </header>

      <section className="strategy-alliance-board" aria-label="Shared alliance board">
        {state.alliances.map((alliance) => (
          <article key={alliance.seed} className="app-card strategy-alliance-card">
            <header>
              <strong>Alliance {alliance.seed}</strong>
            </header>
            <ul>
              <li>
                <span>Captain</span>
                <strong>{teamNumber(alliance.captainTeamKey)}</strong>
              </li>
              <li>
                <span>First pick</span>
                <strong>{teamNumber(alliance.firstPickTeamKey)}</strong>
              </li>
              <li>
                <span>Second pick</span>
                <strong>{teamNumber(alliance.secondPickTeamKey)}</strong>
              </li>
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}
