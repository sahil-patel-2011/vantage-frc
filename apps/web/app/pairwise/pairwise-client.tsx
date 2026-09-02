"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { PairwiseView } from "../../lib/pairwise/compute-pairwise";
import { pairwiseRelatedLinks } from "../../lib/pairwise/pairwise-related";
import { hubHref } from "../../lib/nav/hubs";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./pairwise.css";

type LiveView = Extract<PairwiseView, { status: "live" }>;

export default function PairwiseClient() {
  const [view, setView] = useState<PairwiseView | null>(null);
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [criterionId, setCriterionId] = useState<string | null>(null);

  const load = useCallback(async (nextCriterion?: string | null) => {
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    const query = new URLSearchParams();
    if (orgId) query.set("orgId", orgId);
    const selected = nextCriterion ?? criterionId;
    if (selected) query.set("criterionId", selected);
    try {
      const response = await fetch(`/api/pairwise?${query.toString()}`);
      const data = (await response.json()) as PairwiseView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError(
          "error" in data && data.error ? data.error : "Could not load pairwise ranking.",
        );
        setErrorStatus(response.status);
        return;
      }
      setView(data);
      if (data.status === "live") {
        setCriterionId(data.criterionId);
        if (!left && data.teamNumber) setLeft(String(data.teamNumber));
      }
    } catch {
      setError("Network error — please try again.");
    }
  }, [criterionId, left]);

  useEffect(() => {
    void load();
    // Initial load only — criterion changes call load explicitly.
     
  }, []);

  const [promoted, setPromoted] = useState("");
  const live = view?.status === "live" ? view : null;
  const orgId = live?.orgId ?? (view && "orgId" in view ? view.orgId : null);
  const related = pairwiseRelatedLinks(orgId);

  async function compare(winner: "left" | "right") {
    if (!live || busy) return;
    const winnerTeamNumber = winner === "left" ? left : right;
    const loserTeamNumber = winner === "left" ? right : left;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/pairwise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "compare",
          orgId: live.orgId,
          criterionId: live.criterionId,
          winnerTeamNumber,
          loserTeamNumber,
        }),
      });
      const data = (await response.json()) as PairwiseView | { error?: string };
      if (!response.ok || !("status" in data)) {
        throw new Error("error" in data && data.error ? data.error : "Could not save comparison");
      }
      setView(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save comparison");
    } finally {
      setBusy(false);
    }
  }

  async function remove(comparisonId: string) {
    if (!live || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/pairwise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", orgId: live.orgId, comparisonId, criterionId: live.criterionId }),
      });
      const data = (await response.json()) as PairwiseView;
      if (data && "status" in data) setView(data);
    } finally {
      setBusy(false);
    }
  }

  async function promote(teamNumber: number) {
    if (!live || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/pairwise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "promote_to_pick_list",
          orgId: live.orgId,
          criterionId: live.criterionId,
          teamNumber,
        }),
      });
      const data = (await response.json()) as
        | (PairwiseView & { promoted?: { note: string } | null })
        | { error?: string };
      if (!response.ok || !("status" in data)) {
        throw new Error("error" in data && data.error ? data.error : "Could not promote to the pick list");
      }
      setView(data);
      setPromoted(`${teamNumber} is on the pick list${data.promoted?.note ? ` — ${data.promoted.note}` : ""}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not promote to the pick list");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="module-page pairwise-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? hubHref("/competition", "scouting", orgId) : "/competition"}>Competition</a>
            {" / Pairwise"}
          </>
        }
        title="Pairwise ranking"
        description="Tap who looked better. Ranks come from those taps only — not TBA, not EPA, never invented."
      />

      <nav className="product-hub-related" aria-label="Related qualitative tools">
        {related.map((link) => (
          <a key={link.id} className="app-button secondary" href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>

      {error && view ? <p className="app-muted" role="alert">{error}</p> : null}
      {!view && error
        ? (() => {
            const copy = loadFailureCopy(
              classifyLoadFailure({
                status: errorStatus,
                message: error,
                online: typeof navigator === "undefined" ? true : navigator.onLine,
              }),
              {
                nextPath:
                  typeof window === "undefined"
                    ? null
                    : `${window.location.pathname}${window.location.search}`,
                message: error,
              },
            );
            return (
              <EmptyState title={copy.title} description={copy.description}>
                {copy.primary ? (
                  <a className="app-button" href={copy.primary.href}>
                    {copy.primary.label}
                  </a>
                ) : null}
                {copy.showRetry ? (
                  <button type="button" className="app-button secondary" onClick={() => void load()}>
                    Retry
                  </button>
                ) : null}
              </EmptyState>
            );
          })()
        : null}
      {!view && !error ? <p className="app-muted">Loading qualitative ranks…</p> : null}

      {promoted ? (
        <p className="form-message" role="status">
          {promoted}
        </p>
      ) : null}

      {view?.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          {view.steps.map((step) => (
            <a key={step.id} className="app-button secondary" href={step.href}>
              {step.label}
            </a>
          ))}
        </EmptyState>
      ) : null}

      {live ? (
        <LivePairwise
          view={live}
          left={left}
          right={right}
          busy={busy}
          setLeft={setLeft}
          setRight={setRight}
          onCriterion={(id) => {
            setCriterionId(id);
            void load(id);
          }}
          onCompare={compare}
          onRemove={remove}
          onPromote={promote}
        />
      ) : null}
    </main>
  );
}

function LivePairwise({
  view,
  left,
  right,
  busy,
  setLeft,
  setRight,
  onCriterion,
  onCompare,
  onRemove,
  onPromote,
}: {
  view: LiveView;
  left: string;
  right: string;
  busy: boolean;
  setLeft: (value: string) => void;
  setRight: (value: string) => void;
  onCriterion: (id: string) => void;
  onCompare: (winner: "left" | "right") => void;
  onRemove: (id: string) => void;
  onPromote: (teamNumber: number) => void;
}) {
  const suggestions = view.eventTeams;
  return (
    <div className="pairwise-stack">
      <section className="app-card soft-panel" aria-label="Next actions">
        <h2>What to do next</h2>
        <ul className="pairwise-actions">
          {view.nextActions.map((action) => (
            <li key={action.id}>
              <a className={action.primary ? "app-button" : "app-button secondary"} href={action.href}>
                {action.label}
              </a>
              <span>{action.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="pairwise-criteria" role="tablist" aria-label="Qualitative criteria">
        {view.criteria.map((criterion) => (
          <button
            key={criterion.id}
            type="button"
            role="tab"
            aria-selected={criterion.id === view.criterionId}
            className={criterion.id === view.criterionId ? "app-button" : "app-button secondary"}
            onClick={() => onCriterion(criterion.id)}
          >
            {criterion.name}
            <small> {criterion.comparisonCount}</small>
          </button>
        ))}
      </div>

      <Panel>
        <p className="app-muted">
          Inspired by Pairwise / Maneuver qualitative scouting, but org-scoped and ranked with Bradley-Terry so a few
          honest taps beat a fake 1–10 scale. Event {view.eventKey ?? "not set"}.
        </p>
        <div className="pairwise-bout">
          <label>
            Team A
            <input
              list="pairwise-teams"
              inputMode="numeric"
              value={left}
              onChange={(event) => setLeft(event.target.value)}
              placeholder="254"
            />
          </label>
          <div className="pairwise-bout-actions">
            <button type="button" className="app-button" disabled={busy} onClick={() => onCompare("left")}>
              A looked better
            </button>
            <button type="button" className="app-button" disabled={busy} onClick={() => onCompare("right")}>
              B looked better
            </button>
          </div>
          <label>
            Team B
            <input
              list="pairwise-teams"
              inputMode="numeric"
              value={right}
              onChange={(event) => setRight(event.target.value)}
              placeholder="1678"
            />
          </label>
        </div>
        <datalist id="pairwise-teams">
          {suggestions.map((team) => (
            <option key={team} value={team} />
          ))}
        </datalist>
      </Panel>

      <section className="app-card">
        <header>
          <h2>Rank from recorded taps</h2>
          <p className="app-muted">{view.ranks.length ? `${view.ranks.length} robots` : "Empty until someone compares two teams."}</p>
        </header>
        <div className="biz-table-wrap">
          <table className="biz-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Wins</th>
                <th>Losses</th>
                <th>Strength</th>
                <th>Pick list</th>
              </tr>
            </thead>
            <tbody>
              {view.ranks.map((row) => (
                <tr key={row.teamNumber}>
                  <td>{row.rank}</td>
                  <td>
                    <strong>{row.teamNumber}</strong>
                  </td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td>{row.strength.toFixed(2)}</td>
                  <td>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy}
                      onClick={() => onPromote(row.teamNumber)}
                    >
                      Promote
                    </button>
                  </td>
                </tr>
              ))}
              {!view.ranks.length ? (
                <tr>
                  <td colSpan={6}>No qualitative ranks yet. Strength is not EPA and is not filled in for you.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="app-card">
        <h2>Recent comparisons</h2>
        <ul className="pairwise-recent">
          {view.recent.map((row) => (
            <li key={row.id}>
              <strong>
                {row.winnerTeamNumber} over {row.loserTeamNumber}
              </strong>
              <span>
                {row.loggedByName}
                {row.notes ? ` · ${row.notes}` : ""}
              </span>
              <button type="button" className="danger" disabled={busy} onClick={() => onRemove(row.id)}>
                Undo
              </button>
            </li>
          ))}
          {!view.recent.length ? <li>No taps yet this season.</li> : null}
        </ul>
      </section>
    </div>
  );
}
