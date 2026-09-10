"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PickCandidate, PickTier } from "@vantage/prediction-strategy";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { EmptyState, Panel } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  PICK_DESK_RELATED_INCLUDE,
  classifyPickDeskShell,
  formatPickDeskMetric,
  pickDeskNextActions,
  pickDeskRelatedLinks,
  pickDeskSetupSteps,
  pickDeskShellCopy,
  shouldShowPickDeskSummaryTiles,
  type PickDeskNextAction,
  type PickDeskShellKind,
} from "../../lib/strategy/pick-desk-related";
import type { PickDeskEntry, PickDeskList, PickDeskView } from "../../lib/strategy/pick-desk";
import {
  heatmapCellGrid,
  heatmapCellIntensity,
  heatmapSummaryLine,
  type FieldPositionHeatmap,
} from "../../lib/scouting/heatmap";
import "./pick-desk.css";

/**
 * Where a team scored from, per field_position question on the published form.
 * Data comes precomputed from the desk view; an all-zero grid renders with its
 * honest "no positions recorded" line rather than being hidden.
 */
function PositionHeatPanel({ heatmaps }: { heatmaps: FieldPositionHeatmap[] }) {
  return (
    <div className="pick-heat-panel">
      {heatmaps.map((heatmap) => (
        <figure key={heatmap.fieldKey} className="pick-heat-figure">
          {heatmap.fieldLabel ? <figcaption>{heatmap.fieldLabel}</figcaption> : null}
          <div
            className="pick-heat-grid"
            role="img"
            aria-label={heatmapSummaryLine(heatmap)}
            style={{ gridTemplateColumns: `repeat(${heatmap.grid.cols}, minmax(14px, 1fr))` }}
          >
            {heatmapCellGrid(heatmap).map((cell) => {
              const intensity = heatmapCellIntensity(cell, heatmap);
              return (
                <span
                  key={cell.cell}
                  className="pick-heat-cell"
                  title={cell.count ? `${cell.label}: ${cell.count}` : cell.label}
                  style={{
                    background:
                      intensity > 0
                        ? `color-mix(in srgb, var(--soft-accent, var(--app-accent)) ${Math.round(
                            15 + intensity * 85,
                          )}%, transparent)`
                        : undefined,
                  }}
                />
              );
            })}
          </div>
          <small className="app-muted">{heatmapSummaryLine(heatmap)}</small>
        </figure>
      ))}
    </div>
  );
}

const TIERS: Array<{ id: PickTier; label: string; hint: string }> = [
  { id: "first", label: "First picks", hint: "Alliance anchors / top partners" },
  { id: "second", label: "Second picks", hint: "Complementary scorers & specialists" },
  { id: "third", label: "Third picks", hint: "Depth, defense, climb insurance" },
  { id: "watch", label: "Watch", hint: "Track if metrics improve" },
];

function teamLabel(entry: { teamKey: string; teamNumber?: number | null; nickname?: string | null }) {
  const number = entry.teamNumber ?? entry.teamKey.replace(/^frc/, "");
  return entry.nickname ? `${number} · ${entry.nickname}` : String(number);
}

function metricLine(candidate: PickCandidate | undefined) {
  if (!candidate) return "No event metrics linked";
  const parts = [
    candidate.epa != null ? `EPA ${candidate.epa.toFixed(1)}` : null,
    candidate.pepa != null ? `pEPA ${candidate.pepa.toFixed(1)}` : null,
    candidate.record,
    candidate.rank != null ? `rank ${candidate.rank}` : null,
    candidate.source,
    candidate.scoutSample > 0
      ? `scout n=${candidate.scoutSample}${candidate.reliability != null ? ` · rel ${Math.round(candidate.reliability)}%` : ""}`
      : null,
    (candidate.tbaConflictCount ?? 0) > 0
      ? `TBA conflict×${candidate.tbaConflictCount}${candidate.tbaConflictFields?.length ? ` (${candidate.tbaConflictFields.slice(0, 3).join(", ")})` : ""}`
      : null,
  ].filter(Boolean);
  return parts.join(" · ") || "Metrics incomplete";
}

function PickDeskRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = pickDeskRelatedLinks(orgId, {
    include: [...PICK_DESK_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related pick-desk-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function PickDeskNextActionsPanel({ actions }: { actions: PickDeskNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions pick-desk-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PickDeskShell({
  orgId,
  shell,
  error,
  onRetry,
  embedded,
  children,
}: {
  orgId?: string | null;
  shell: PickDeskShellKind;
  error?: string;
  onRetry?: () => void;
  embedded?: boolean;
  children?: ReactNode;
}) {
  const actions = pickDeskNextActions({ orgId, shell });
  const copy = pickDeskShellCopy(shell);
  const steps = shell === "setup" ? pickDeskSetupSteps(orgId) : [];
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const coverageHref = withOrgHref("/scouting/lineup", orgId);
  const commandHref = hubHref("/competition", "command", orgId);
  const teamDataHref = withOrgHref("/team/data", orgId);

  return (
    <section
      className={`strategy-pick-desk pick-desk-workbench soft-gate${embedded ? " embedded" : ""}`}
      aria-label="Pick list setup"
    >
      <header className="pick-desk-heading">
        <div>
          <h2 style={{ marginTop: 0 }}>Event pick desk</h2>
          <p className="app-muted">
            First / second / third pick tiers from synced TBA/Statbotics rows and scout depth.
          </p>
        </div>
        <PickDeskRelatedStrip orgId={orgId} />
      </header>
      {children}
      <EmptyState
        soft
        className="pick-desk-empty"
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No event metrics yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? commandHref : "/workspace"}>
            {orgId ? "Set active event" : "Select workspace"}
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={teamDataHref}>
              Sync event metrics
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={scoutingHref}>
              Open Scouting
            </a>
            <a className="app-button secondary" href={coverageHref}>
              Open Coverage
            </a>
          </>
        ) : null}
      </EmptyState>
      {steps.length > 0 ? (
        <Panel className="pick-desk-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="pick-desk-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <PickDeskNextActionsPanel actions={actions} />
    </section>
  );
}

export function PickListWorkbench({
  orgId,
  embedded,
}: {
  orgId: string | null;
  embedded?: boolean;
}) {
  const [desk, setDesk] = useState<PickDeskView | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [setupMessage, setSetupMessage] = useState("");
  const [setupOrgId, setSetupOrgId] = useState<string | null>(orgId);
  const [setupEventKey, setSetupEventKey] = useState<string | null>(null);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("Alliance picks");
  const [entries, setEntries] = useState<PickDeskEntry[]>([]);
  const [status, setStatus] = useState("");
  const [heatOpenFor, setHeatOpenFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seating, setSeating] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(() => {
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    setLoading(true);
    setFetchFailed(false);
    void fetch(`/api/strategy/pick-desk${qs}`)
      .then(async (response) => {
        const data = await response.json();
        if (data.status === "setup_required") {
          setDesk(null);
          setSetupMessage(data.message ?? "Setup required");
          setSetupOrgId(typeof data.orgId === "string" ? data.orgId : orgId);
          setSetupEventKey(typeof data.eventKey === "string" ? data.eventKey : null);
          return;
        }
        const view = data as PickDeskView;
        setDesk(view);
        setSetupMessage("");
        setSetupOrgId(view.orgId);
        setSetupEventKey(view.eventKey);
        setActiveListId((currentId) => {
          const preferred = view.pickLists.find((list) => list.id === currentId) ?? view.pickLists[0];
          if (preferred) {
            setDraftName(preferred.name);
            setEntries(preferred.entries);
            return preferred.id;
          }
          setEntries([]);
          return null;
        });
      })
      .catch(() => {
        setDesk(null);
        setSetupMessage("");
        setFetchFailed(true);
      })
      .finally(() => setLoading(false));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const shell = classifyPickDeskShell({
    loading,
    fetchFailed,
    status: setupMessage
      ? "setup_required"
      : desk
        ? "live"
        : !loading && !fetchFailed
          ? "setup_required"
          : null,
    orgId: desk?.orgId ?? setupOrgId ?? orgId,
    eventKey: desk?.eventKey ?? setupEventKey,
    candidateCount: desk?.candidates.length ?? 0,
  });

  const byKey = useMemo(() => {
    const map = new Map<string, PickCandidate>();
    for (const candidate of desk?.candidates ?? []) map.set(candidate.teamKey, candidate);
    return map;
  }, [desk]);

  const listed = useMemo(() => new Set(entries.map((entry) => entry.teamKey)), [entries]);

  const pool = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (desk?.candidates ?? []).filter((candidate) => {
      if (listed.has(candidate.teamKey)) return false;
      if (!q) return true;
      return (
        candidate.teamKey.toLowerCase().includes(q) ||
        String(candidate.teamNumber ?? "").includes(q) ||
        (candidate.nickname ?? "").toLowerCase().includes(q)
      );
    });
  }, [desk, listed, filter]);

  function entriesForTier(tier: PickTier) {
    return entries
      .filter((entry) => (entry.tier ?? "watch") === tier)
      .sort((a, b) => a.rank - b.rank);
  }

  function reindex(next: PickDeskEntry[]) {
    const order = TIERS.flatMap((tier) => next.filter((entry) => (entry.tier ?? "watch") === tier.id));
    return order.map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  function addToTier(candidate: PickCandidate, tier: PickTier) {
    if (listed.has(candidate.teamKey)) return;
    setEntries((current) =>
      reindex([
        ...current,
        {
          teamKey: candidate.teamKey,
          teamNumber: candidate.teamNumber,
          nickname: candidate.nickname,
          rank: current.length + 1,
          tier,
          notes: null,
        },
      ]),
    );
  }

  function moveEntry(teamKey: string, tier: PickTier) {
    setEntries((current) =>
      reindex(current.map((entry) => (entry.teamKey === teamKey ? { ...entry, tier } : entry))),
    );
  }

  function removeEntry(teamKey: string) {
    setEntries((current) => reindex(current.filter((entry) => entry.teamKey !== teamKey)));
  }

  function shiftRank(teamKey: string, direction: -1 | 1) {
    setEntries((current) => {
      const tier = (current.find((entry) => entry.teamKey === teamKey)?.tier ?? "watch") as PickTier;
      const column = current
        .filter((entry) => (entry.tier ?? "watch") === tier)
        .sort((a, b) => a.rank - b.rank);
      const index = column.findIndex((entry) => entry.teamKey === teamKey);
      const swapWith = index + direction;
      if (index < 0 || swapWith < 0 || swapWith >= column.length) return current;
      const a = column[index]!;
      const b = column[swapWith]!;
      return reindex(
        current.map((entry) => {
          if (entry.teamKey === a.teamKey) return { ...entry, rank: b.rank };
          if (entry.teamKey === b.teamKey) return { ...entry, rank: a.rank };
          return entry;
        }),
      );
    });
  }

  async function saveList() {
    if (!desk) return;
    if (!desk.canEdit) {
      setStatus("Owner or admin role required to save pick lists.");
      return;
    }
    setSaving(true);
    setStatus("Saving pick list…");
    const response = await fetch("/api/intel/pick-lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId: desk.orgId,
        id: activeListId ?? undefined,
        eventKey: desk.eventKey,
        name: draftName.trim() || "Alliance picks",
        entries: entries.map((entry) => ({
          teamKey: entry.teamKey,
          rank: entry.rank,
          tier: entry.tier ?? "watch",
          notes: entry.notes ?? undefined,
        })),
      }),
    });
    const data = (await response.json()) as {
      id?: string;
      error?: string;
      influence?: { attributed?: number; notified?: number };
    };
    if (response.ok) {
      const attributed = data.influence?.attributed ?? 0;
      const notified = data.influence?.notified ?? 0;
      setStatus(
        attributed > 0
          ? `Pick list saved. Told ${notified} scout${notified === 1 ? "" : "s"} where ${attributed} entr${attributed === 1 ? "y" : "ies"} went.`
          : "Pick list saved. No scout entries to attribute yet.",
      );
      if (data.id) setActiveListId(data.id);
      load();
    } else {
      setStatus(data.error ?? "Save failed");
    }
    setSaving(false);
  }

  async function seatTopScouts() {
    if (!desk?.canEdit) {
      setStatus("Owner or admin role required to seat scouts.");
      return;
    }
    setSeating(true);
    setStatus("Seating top accurate scouts…");
    const response = await fetch("/api/scouting/trust", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId: desk.orgId,
        eventKey: desk.eventKey,
        action: "seat-top-accurate",
        seatCount: 3,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      strategySeats?: unknown[];
    };
    setStatus(
      response.ok
        ? `Seated top accurate scouts into the pick-desk conversation (${data.strategySeats?.length ?? 0} seat${(data.strategySeats?.length ?? 0) === 1 ? "" : "s"}).`
        : data.error ?? "Could not seat scouts",
    );
    setSeating(false);
    if (response.ok) load();
  }

  function selectList(list: PickDeskList) {
    setActiveListId(list.id);
    setDraftName(list.name);
    setEntries(list.entries);
  }

  if (shell !== "ready") {
    return (
      <PickDeskShell
        orgId={desk?.orgId ?? setupOrgId ?? orgId}
        shell={shell}
        error={
          shell === "error"
            ? "Could not load pick desk."
            : shell === "setup" && setupMessage
              ? `${setupMessage} Pick ranks stay empty until real event metrics exist.`
              : undefined
        }
        onRetry={shell === "error" ? () => load() : undefined}
        embedded={embedded}
      />
    );
  }

  if (!desk) {
    return (
      <PickDeskShell orgId={setupOrgId ?? orgId} shell="loading" embedded={embedded} />
    );
  }

  const showTiles = shouldShowPickDeskSummaryTiles(desk.candidates.length);
  const readyActions = pickDeskNextActions({
    orgId: desk.orgId,
    shell: "ready",
    eventKey: desk.eventKey,
    candidateCount: desk.candidates.length,
    listCount: desk.pickLists.length,
  });
  const coverageHref = withOrgHref("/scouting/lineup", desk.orgId);
  const pickClockHref = withOrgHref("/pick-clock", desk.orgId);
  const draftHref = withOrgHref("/strategy/draft", desk.orgId);

  return (
    <section
      className={`strategy-pick-desk pick-desk-workbench${embedded ? " embedded" : ""}`}
      aria-label="Pick list workbench"
    >
      <DataSourceDegradedBanner health={desk.dataSourceHealth} compact />
      <header className="pick-desk-heading">
        <div>
          {desk.pickMode === "low_data_tba" ? (
            <span className="app-badge setup">Low-data TBA</span>
          ) : (
            <span className="app-badge good">Real event inputs</span>
          )}
          <h2 style={{ marginTop: 8 }}>First / second / third pick desk</h2>
          <p className="app-muted">
            {desk.eventName ?? desk.eventKey}
            {desk.sources.length ? ` · ${desk.sources.join(" + ")}` : " · no metrics synced yet"}
            {" · "}
            {formatPickDeskMetric(desk.candidates.length, true)} teams with reference rows
            {desk.pickMode === "low_data_tba" && desk.pickModeReason ? ` · ${desk.pickModeReason}` : ""}
            {desk.epaDrifts?.length
              ? ` · ${formatPickDeskMetric(desk.epaDrifts.length, true)} EPA-drift callout${desk.epaDrifts.length === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>
        <div className="strategy-pick-actions">
          <PickDeskRelatedStrip orgId={desk.orgId} />
          <a className="app-button secondary" href={pickClockHref}>
            Pick clock
          </a>
          <a className="app-button secondary" href={draftHref}>
            Open draft day
          </a>
          {desk.canEdit ? (
            <button
              type="button"
              className="app-button secondary"
              onClick={() => void seatTopScouts()}
              disabled={seating}
            >
              {seating ? "Seating…" : "Seat top scouts"}
            </button>
          ) : null}
          <button type="button" className="app-button secondary" onClick={saveList} disabled={saving}>
            {saving ? "Saving…" : "Save pick list"}
          </button>
        </div>
      </header>

      {desk.pickMode === "low_data_tba" ? (
        <p className="strategy-pick-coverage-hint app-muted" role="status">
          Thin scout depth —{" "}
          <a href={coverageHref}>open scout coverage</a> or add notes in Scouting before trusting pick
          explainability.
        </p>
      ) : null}

      {showTiles ? (
        <div className="pick-desk-kpis" aria-label="Pick desk counts">
          <article>
            <strong>{formatPickDeskMetric(desk.candidates.length, true)}</strong>
            <small>event teams</small>
          </article>
          <article>
            <strong>{formatPickDeskMetric(desk.scoutedTeams, true)}</strong>
            <small>with scout depth</small>
          </article>
          <article>
            <strong>{formatPickDeskMetric(desk.pickLists.length, true)}</strong>
            <small>saved lists</small>
          </article>
        </div>
      ) : null}

      <article className="app-card strategy-pick-seats" aria-label="Strategy meeting seats">
        <header>
          <h3>Strategy meeting seats</h3>
          <small>
            Top TBA-accurate scouts rotate into this pick-desk conversation so they see their product used.
          </small>
        </header>
        {(desk.strategySeats ?? []).length ? (
          <ul>
            {(desk.strategySeats ?? []).map((seat) => (
              <li key={`${seat.userId}-${seat.meetingOn}`}>
                <strong>
                  {seat.name}
                  {seat.isMe ? " (you)" : ""}
                </strong>
                <small>
                  {seat.meetingOn} · {seat.reason}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="app-muted">
            No seats yet
            {desk.canEdit ? " — use Seat top scouts after validations exist." : "."}
          </p>
        )}
      </article>

      <div className="strategy-pick-toolbar app-card">
        <label>
          List name
          <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
        </label>
        <label>
          Filter pool
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Team # or nickname"
          />
        </label>
        {desk.pickLists.length ? (
          <div className="strategy-pick-list-switch" role="tablist" aria-label="Saved pick lists">
            {desk.pickLists.map((list) => (
              <button
                key={list.id}
                type="button"
                role="tab"
                aria-selected={list.id === activeListId}
                className={list.id === activeListId ? "active" : undefined}
                onClick={() => selectList(list)}
              >
                {list.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="app-muted">No saved lists yet — arrange tiers below, then save.</p>
        )}
        {!desk.canEdit ? (
          <p className="telemetry-status" role="status">
            Read-only for your role. Owners/admins can save durable pick lists.
          </p>
        ) : null}
        {status ? (
          <p className="telemetry-status success" role="status">
            {status}
          </p>
        ) : null}
      </div>

      <div className="strategy-pick-columns">
        {TIERS.map((tier) => (
          <article key={tier.id} className="app-card strategy-pick-column">
            <header>
              <h3>{tier.label}</h3>
              <small>{tier.hint}</small>
            </header>
            <ul>
              {entriesForTier(tier.id).map((entry) => {
                const candidate = byKey.get(entry.teamKey);
                return (
                  <li key={entry.teamKey}>
                    <div>
                      <strong>
                        #{entry.rank} {teamLabel(entry)}
                      </strong>
                      <small>{metricLine(candidate)}</small>
                    </div>
                    <div className="strategy-pick-row-actions">
                      <button type="button" onClick={() => shiftRank(entry.teamKey, -1)} aria-label="Move up">
                        ↑
                      </button>
                      <button type="button" onClick={() => shiftRank(entry.teamKey, 1)} aria-label="Move down">
                        ↓
                      </button>
                      {TIERS.filter((item) => item.id !== tier.id).map((item) => (
                        <button key={item.id} type="button" onClick={() => moveEntry(entry.teamKey, item.id)}>
                          {item.id[0]!.toUpperCase()}
                        </button>
                      ))}
                      <button type="button" onClick={() => removeEntry(entry.teamKey)}>
                        Remove
                      </button>
                      {desk.positionHeatByTeam?.[entry.teamKey]?.length ? (
                        <button
                          type="button"
                          aria-expanded={heatOpenFor === entry.teamKey}
                          onClick={() =>
                            setHeatOpenFor((current) =>
                              current === entry.teamKey ? null : entry.teamKey,
                            )
                          }
                        >
                          {heatOpenFor === entry.teamKey ? "Hide heat" : "Heat"}
                        </button>
                      ) : null}
                    </div>
                    {heatOpenFor === entry.teamKey && desk.positionHeatByTeam?.[entry.teamKey] ? (
                      <PositionHeatPanel heatmaps={desk.positionHeatByTeam[entry.teamKey]!} />
                    ) : null}
                  </li>
                );
              })}
              {!entriesForTier(tier.id).length ? (
                <li className="strategy-pick-empty">
                  Drop teams from the pool — empty tiers stay empty.
                </li>
              ) : null}
            </ul>
          </article>
        ))}
      </div>

      <article className="app-card strategy-pick-pool">
        <header>
          <h3>Event pool</h3>
          <small>
            Only teams with synced TBA/Statbotics rows. Suggestions use event EPA / org pEPA
            percentiles + scout reliability.
          </small>
        </header>
        {!pool.length ? (
          <p className="app-muted">
            {desk.candidates.length
              ? "All listed teams are already on this pick list, or the filter hid them."
              : "No team_event_metrics for this event yet — sync TBA/Statbotics under Team → Data."}
          </p>
        ) : (
          <ul>
            {pool.map((candidate) => (
              <li key={candidate.teamKey}>
                <div>
                  <strong>{teamLabel(candidate)}</strong>
                  <small>{metricLine(candidate)}</small>
                  {candidate.suggestedTier ? (
                    <em className="strategy-suggest">Suggested {candidate.suggestedTier}</em>
                  ) : (
                    <em className="strategy-suggest muted">No EPA — no suggestion</em>
                  )}
                </div>
                <div className="strategy-pick-row-actions">
                  {TIERS.map((tier) => (
                    <button key={tier.id} type="button" onClick={() => addToTier(candidate, tier.id)}>
                      + {tier.label.replace(" picks", "").replace("Watch", "Watch")}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      <PickDeskNextActionsPanel actions={readyActions} />
    </section>
  );
}
