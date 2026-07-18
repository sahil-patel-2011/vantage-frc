"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "../../../components/ui";
import {
  draftShellCopy,
  isDraftShareTokenOrgIsolated,
} from "../../../lib/strategy/draft-related";
import type { AllianceBoardState } from "../../../lib/strategy/pick-desk";
import "../draft/draft.css";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("Missing share token.");
      setLoading(false);
      return;
    }
    void fetch(`/api/strategy/draft/public?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data?.error) {
          setError(data.error ?? "Board unavailable");
          return;
        }
        const next = data as Snapshot;
        // Share tokens resolve only the issuing org + board — never DEMO / cross-org boards.
        if (!isDraftShareTokenOrgIsolated(next)) {
          setError("Alliance board link is invalid or expired");
          return;
        }
        setSnapshot(next);
      })
      .catch(() => setError("Could not load shared alliance board."))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    const copy = draftShellCopy("error");
    return (
      <main className="module-page strategy-board-public draft-board-workbench soft-gate">
        <EmptyState
          soft
          className="draft-empty"
          badge="Unavailable"
          badgeTone="setup"
          title={copy.title}
          description={`${error} Mentor links stay org-bound — never DEMO boards or cross-org snapshots.`}
        />
      </main>
    );
  }

  if (loading || !snapshot) {
    const copy = draftShellCopy("loading");
    return (
      <main className="module-page strategy-board-public draft-board-workbench soft-gate">
        <EmptyState
          soft
          className="draft-empty"
          title={copy.title}
          description="Resolving the org-bound mentor token — never DEMO boards."
          aria-busy
        />
      </main>
    );
  }

  const state = snapshot.state;

  return (
    <main className="module-page strategy-board-public draft-board-workbench">
      <header className="app-page-header draft-board-heading">
        <div>
          <span className="breadcrumbs">Vantage · Read-only mentor view</span>
          <h1>{snapshot.name}</h1>
          <p>
            {snapshot.eventName ?? snapshot.eventKey} · updated{" "}
            {new Date(snapshot.updatedAt).toLocaleString()} · link expires{" "}
            {new Date(snapshot.expiresAt).toLocaleString()}
          </p>
          <p className="app-muted draft-share-note">
            Org-bound share token — this snapshot belongs only to the issuing workspace. Never DEMO
            boards.
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
