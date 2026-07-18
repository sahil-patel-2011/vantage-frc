"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader } from "../../../components/ui";
import type { CoverageGapSlot, CoverageGapSummary } from "@vantage/scouting/coverage";

type CoverageView =
  | {
      status: "setup_required";
      eventKey: null;
      generatedAt: string;
      message: string;
    }
  | {
      status: "live";
      eventKey: string;
      generatedAt: string;
      qualsOnly: boolean;
      summary: CoverageGapSummary;
      live: {
        focusMatchKeys: string[];
        focusSlots: CoverageGapSlot[];
        gapSlots: CoverageGapSlot[];
        doubleSlots: CoverageGapSlot[];
      };
      slots: CoverageGapSlot[];
    };

const POLL_MS = 8000;

function pct(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function teamLabel(slot: CoverageGapSlot): string {
  return slot.teamNumber != null ? String(slot.teamNumber) : slot.teamKey.replace(/^frc/i, "");
}

function statusLabel(status: CoverageGapSlot["status"]): string {
  if (status === "double") return "Double scouted";
  if (status === "unscouted") return "Unscouted";
  if (status === "assigned") return "Assigned, waiting";
  return "Covered";
}

export default function LineupClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<CoverageView | null>(null);
  const [error, setError] = useState("");
  const [qualsOnly, setQualsOnly] = useState(true);
  const [focusMatch, setFocusMatch] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ orgId, window: "4" });
    if (!qualsOnly) params.set("qualsOnly", "0");
    if (focusMatch) params.set("matchKey", focusMatch);
    try {
      const response = await fetch(`/api/scouting/coverage?${params}`);
      const data = (await response.json()) as CoverageView & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not load coverage.");
        return;
      }
      setView(data);
      setUpdatedAt(data.generatedAt);
      setError("");
      if (data.status === "live" && data.live.focusMatchKeys[0] && !focusMatch) {
        setFocusMatch(data.live.focusMatchKeys[0]!);
      }
    } catch {
      setError("Network error — coverage will retry.");
    }
  }, [focusMatch, orgId, qualsOnly]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const matchOptions = useMemo(() => {
    if (!view || view.status !== "live") return [];
    const seen = new Set<string>();
    const options: Array<{ matchKey: string; label: string }> = [];
    for (const slot of view.slots) {
      if (seen.has(slot.matchKey)) continue;
      seen.add(slot.matchKey);
      options.push({
        matchKey: slot.matchKey,
        label: `${slot.compLevel.toUpperCase()} ${slot.matchNumber}`,
      });
    }
    return options;
  }, [view]);

  const grouped = useMemo(() => {
    if (!view || view.status !== "live") return [];
    const byMatch = new Map<string, CoverageGapSlot[]>();
    for (const slot of view.live.focusSlots) {
      const list = byMatch.get(slot.matchKey) ?? [];
      list.push(slot);
      byMatch.set(slot.matchKey, list);
    }
    return view.live.focusMatchKeys.map((key) => ({
      matchKey: key,
      slots: byMatch.get(key) ?? [],
    }));
  }, [view]);

  return (
    <main className="module-page lineup-page">
      <PageHeader
        breadcrumbs="Competition / Scouting / Lineup"
        title="Live coverage gaps"
        description="Double-scouted vs unscouted robots for the live quals window. Attribution uses membership IDs — never typed scout names."
      >
        <div className="lineup-header-meta">
          <span className="lineup-live-pill" aria-live="polite">
            {view?.status === "live" ? "Live" : "Idle"} · refresh {POLL_MS / 1000}s
            {updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString()}` : ""}
          </span>
          <a className="app-button secondary" href={`/scouting?orgId=${encodeURIComponent(orgId)}`}>
            Scout forms
          </a>
        </div>
      </PageHeader>

      {error ? (
        <p className="form-message" role="status">
          {error}
        </p>
      ) : null}

      {!view ? <p className="app-muted">Loading coverage board…</p> : null}

      {view?.status === "setup_required" ? (
        <EmptyState
          badge="Setup required"
          badgeTone="setup"
          title="No active event"
          description={view.message}
        >
          <a className="app-button secondary" href={`/command?orgId=${encodeURIComponent(orgId)}`}>
            Select event
          </a>
        </EmptyState>
      ) : null}

      {view?.status === "live" ? (
        <>
          <section className="lineup-controls" aria-label="Coverage filters">
            <label>
              Focus match
              <select value={focusMatch} onChange={(event) => setFocusMatch(event.target.value)}>
                {matchOptions.map((option) => (
                  <option key={option.matchKey} value={option.matchKey}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="lineup-check">
              <input
                type="checkbox"
                checked={qualsOnly}
                onChange={(event) => setQualsOnly(event.target.checked)}
              />
              Quals only
            </label>
            <span className="app-muted">{view.eventKey}</span>
          </section>

          <section className="lineup-kpis" aria-label="Coverage summary">
            <article>
              <span>Unscouted</span>
              <strong>{view.summary.unscouted}</strong>
              <small>no entry yet</small>
            </article>
            <article>
              <span>Double scouted</span>
              <strong>{view.summary.doubleCovered}</strong>
              <small>{pct(view.summary.doubleRate)} of slots</small>
            </article>
            <article>
              <span>Covered</span>
              <strong>{view.summary.covered + view.summary.doubleCovered}</strong>
              <small>{pct(view.summary.coverageRate)} coverage</small>
            </article>
            <article>
              <span>Assigned waiting</span>
              <strong>{view.summary.assignedWaiting}</strong>
              <small>scout has the row</small>
            </article>
          </section>

          <section className="lineup-split">
            <div className="lineup-panel">
              <header>
                <h2>Needs coverage</h2>
                <p className="app-muted">Unscouted or assigned-but-empty in the live window.</p>
              </header>
              {view.live.gapSlots.length ? (
                <ul className="lineup-gap-list">
                  {view.live.gapSlots.map((slot) => (
                    <li key={`${slot.matchKey}-${slot.teamKey}`} className={slot.status}>
                      <strong>
                        {slot.compLevel.toUpperCase()} {slot.matchNumber} · {teamLabel(slot)}
                      </strong>
                      <span>{statusLabel(slot.status)}</span>
                      <a
                        href={`/scouting?orgId=${encodeURIComponent(orgId)}&matchKey=${encodeURIComponent(slot.matchKey)}&teamKey=${encodeURIComponent(slot.teamKey)}`}
                      >
                        Scout now
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="app-muted">No gaps in the current window.</p>
              )}
            </div>

            <div className="lineup-panel">
              <header>
                <h2>Double scouted</h2>
                <p className="app-muted">More than one membership-bound entry for the same robot.</p>
              </header>
              {view.live.doubleSlots.length ? (
                <ul className="lineup-gap-list">
                  {view.live.doubleSlots.map((slot) => (
                    <li key={`${slot.matchKey}-${slot.teamKey}`} className="double">
                      <strong>
                        {slot.compLevel.toUpperCase()} {slot.matchNumber} · {teamLabel(slot)}
                      </strong>
                      <span>
                        {slot.entryCount} scouts · {slot.scoutNames?.join(", ") || "members"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="app-muted">No doubles in the current window.</p>
              )}
            </div>
          </section>

          <section className="lineup-board-wrap">
            <header>
              <h2>Live window</h2>
              <p className="app-muted">Next matches from the focus point — color shows gap vs double.</p>
            </header>
            {grouped.map((group) => {
              const sample = group.slots[0];
              return (
                <div key={group.matchKey} className="lineup-match">
                  <h3>
                    {sample
                      ? `${sample.compLevel.toUpperCase()} ${sample.matchNumber}`
                      : group.matchKey}
                  </h3>
                  <div className="lineup-board">
                    {group.slots.map((slot) => (
                      <article key={`${slot.matchKey}-${slot.teamKey}`} className={slot.status}>
                        <b>{slot.alliance ?? "—"}</b>
                        <span>{teamLabel(slot)}</span>
                        <small>
                          {statusLabel(slot.status)}
                          {slot.status === "double" && slot.scoutNames?.length
                            ? ` · ${slot.scoutNames.join(" / ")}`
                            : ""}
                        </small>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
            {!grouped.length ? (
              <p className="app-muted">
                Match schedule is empty. Sync TBA after the event schedule publishes — nothing is invented.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
