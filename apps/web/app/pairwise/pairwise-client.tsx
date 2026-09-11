"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, ToolStrip, Button } from "../../components/ui";
import type { PairwiseView } from "../../lib/pairwise/compute-pairwise";
import type { PairwisePromoteResult } from "../../lib/pairwise/promote-to-pick-list";
import { pairwiseRelatedLinks } from "../../lib/pairwise/pairwise-related";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./pairwise.css";

type LiveView = Extract<PairwiseView, { status: "live" }>;
type PairwiseResponse = PairwiseView & { promotion?: PairwisePromoteResult; error?: string };

function isPairwiseView(value: unknown): value is PairwiseView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistPairwiseSnapshot(orgHint: string, data: PairwiseView): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("pairwise", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("pairwise", "_", data);
  } catch {
    // Live ranking already painted; IndexedDB is best-effort.
  }
}

export default function PairwiseClient() {
  const [view, setView] = useState<PairwiseView | null>(null);
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [criterionId, setCriterionId] = useState<string | null>(null);
  const [promoteMessage, setPromoteMessage] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<PairwiseView | null>(null);
  viewRef.current = view;

  const load = useCallback(async (nextCriterion?: string | null) => {
    const orgId = new URLSearchParams(window.location.search).get("orgId")?.trim() ?? "";
    const query = new URLSearchParams();
    if (orgId) query.set("orgId", orgId);
    const selected = nextCriterion ?? criterionId;
    if (selected) query.set("criterionId", selected);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<PairwiseView>("pairwise", orgId || "_");
      if (!viewRef.current && cached?.data && isPairwiseView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
        if (cached.data.status === "live") {
          setCriterionId(cached.data.criterionId);
          if (!left && cached.data.teamNumber) setLeft(String(cached.data.teamNumber));
        }
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    try {
      const response = await fetch(`/api/pairwise?${query.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as PairwiseResponse;
      if (!response.ok || !isPairwiseView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Pairwise ranking. Showing the last copy on this device.");
        } else {
          setError(data.error ? data.error : "Could not load pairwise ranking.");
          setErrorStatus(response.status);
        }
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setError("");
      if (data.status === "live") {
        setCriterionId(data.criterionId);
        if (!left && data.teamNumber) setLeft(String(data.teamNumber));
      }
      await persistPairwiseSnapshot(orgId, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Pairwise ranking. Showing the last copy on this device.");
      } else {
        setError("Network error — please try again.");
      }
    }
  }, [criterionId, left]);

  useEffect(() => {
    void load();
    // Initial load only — criterion changes call load explicitly.
     
  }, []);

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
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as PairwiseResponse;
      if (!response.ok || !isPairwiseView(data)) {
        throw new Error(data.error ? data.error : "Could not save comparison");
      }
      setView(data);
      void persistPairwiseSnapshot(live.orgId, data);
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
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as PairwiseResponse;
      if (data && isPairwiseView(data)) {
        setView(data);
        void persistPairwiseSnapshot(live.orgId, data);
      }
    } finally {
      setBusy(false);
    }
  }

  async function promote() {
    if (!live || busy || !live.ranks.length) return;
    setBusy(true);
    setError("");
    setPromoteMessage("");
    try {
      const response = await fetch("/api/pairwise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "promote-to-pick-list",
          orgId: live.orgId,
          criterionId: live.criterionId,
        }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as PairwiseResponse;
      if (!response.ok || !isPairwiseView(data)) {
        throw new Error(data.error ? data.error : "Could not save pairwise order to the pick list");
      }
      setView(data);
      void persistPairwiseSnapshot(live.orgId, data);
      setPromoteMessage(data.promotion?.message ?? "Saved pairwise order to the pick list.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save pairwise order to the pick list");
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
        description="Tap who looked better. Ranks come from your taps — not from official rankings or EPA."
      />
      <OfflineBanner feature="Pairwise ranking" fromCache={fromCache} cachedAt={cachedAt} />

      <nav className="product-hub-related" aria-label="Related qualitative tools">
        {related.map((link) => (
          <Button as="a" variant="secondary" key={link.id} href={link.href}>
            {link.label}
          </Button>
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
                  <Button as="a" variant="primary" href={copy.primary.href}>
                    {copy.primary.label}
                  </Button>
                ) : null}
                {copy.showRetry ? (
                  <Button variant="secondary" type="button" onClick={() => void load()}>
                    Retry
                  </Button>
                ) : null}
              </EmptyState>
            );
          })()
        : null}
      {!view && !error ? <p className="app-muted">Loading qualitative ranks…</p> : null}

      {view?.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
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
          promoteMessage={promoteMessage}
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
  promoteMessage,
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
  onPromote: () => void;
  promoteMessage: string;
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

      <ToolStrip
        aria-label="Qualitative criteria"
        value={view.criterionId}
        onChange={onCriterion}
        visibleCount={8}
        items={view.criteria.map((criterion) => ({
          id: criterion.id,
          label: `${criterion.name} (${criterion.comparisonCount})`,
        }))}
      />

      <Panel>
        <p className="app-muted">
          Inspired by Pairwise / Maneuver qualitative scouting, ranked with Bradley-Terry so a few honest taps beat a
          guessed 1–10 scale. Event {view.eventKey ?? "not set"}.
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
            <Button variant="primary" type="button" disabled={busy} onClick={() => onCompare("left")}>
              A looked better
            </Button>
            <Button variant="primary" type="button" disabled={busy} onClick={() => onCompare("right")}>
              B looked better
            </Button>
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
        <div className="pairwise-promote">
          <Button variant="primary" type="button" disabled={busy || !view.ranks.length || !view.eventKey} onClick={onPromote}>
            Save order to pick list
          </Button>
          {!view.ranks.length ? (
            <p className="app-muted">Nothing to promote until a scout records a real A-beats-B tap.</p>
          ) : !view.eventKey ? (
            <p className="app-muted">Set an active event before writing this order to the pick list.</p>
          ) : (
            <p className="app-muted">Writes this tap order onto the same list the desk and Pick Clock read.</p>
          )}
        </div>
        {promoteMessage ? (
          <p className="app-muted" role="status">
            {promoteMessage}{" "}
            <a href={hubHref("/competition", "picklist-collab", view.orgId)}>Open pick list</a>
          </p>
        ) : null}
        <div className="biz-table-wrap">
          <table className="biz-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Wins</th>
                <th>Losses</th>
                <th>Strength</th>
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
                </tr>
              ))}
              {!view.ranks.length ? (
                <tr>
                  <td colSpan={5}>No qualitative ranks yet. Strength is not EPA and is not filled in for you.</td>
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
