"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PickCandidate, PickTier } from "@vantage/prediction-strategy";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
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
import { getFeatureSnapshot, putFeatureSnapshot, clearFeatureSnapshot } from "../../lib/offline/feature-cache";
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
                        ? `color-mix(in srgb, var(--accent) ${Math.round(
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

function isPickDeskView(value: unknown): value is PickDeskView {
  if (!value || typeof value !== "object") return false;
  const row = value as { orgId?: unknown; candidates?: unknown; pickLists?: unknown };
  return typeof row.orgId === "string" && Array.isArray(row.candidates) && Array.isArray(row.pickLists);
}

const TIERS: Array<{ id: PickTier; label: string; hint: string }> = [
  { id: "first", label: "First picks", hint: "Alliance captains / first partners" },
  { id: "second", label: "Second picks", hint: "Partners who fill the gaps" },
  { id: "third", label: "Third picks", hint: "Backup, defense, climb" },
  { id: "watch", label: "Watch", hint: "Keep an eye on these" },
];

function teamLabel(entry: { teamKey: string; teamNumber?: number | null; nickname?: string | null }) {
  const number = entry.teamNumber ?? entry.teamKey.replace(/^frc/, "");
  return entry.nickname ? `${number} · ${entry.nickname}` : String(number);
}

function metricLine(candidate: PickCandidate | undefined) {
  if (!candidate) return "No numbers yet";
  const parts = [
    candidate.pepa != null ? `Our scouting ${candidate.pepa.toFixed(1)}` : null,
    candidate.record,
    candidate.rank != null ? `event rank ${candidate.rank}` : null,
    candidate.scoutSample > 0
      ? `scouted ${candidate.scoutSample} match${candidate.scoutSample === 1 ? "" : "es"}`
      : null,
  ].filter(Boolean);
  return parts.join(" · ") || "No numbers yet";
}

function PickDeskRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = pickDeskRelatedLinks(orgId, {
    include: [...PICK_DESK_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related pick-desk-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
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
  const setup = shell === "setup" ? pickDeskSetupSteps(orgId)[0] : null;
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  return (
    <section
      className={`strategy-pick-desk pick-desk-workbench soft-gate${embedded ? " embedded" : ""}`}
      aria-label="Pick list setup"
    >
      <header className="pick-desk-heading">
        <div>
          <h2 style={{ marginTop: 0 }}>Pick desk</h2>
          <p className="app-muted">
            Rank teams into first / second / third, then lock the list.
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
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No teams yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={scoutingHref}>
            Open Scouting
          </Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <PickDeskNextActionsPanel actions={actions} /> : null}
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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const deskRef = useRef<PickDeskView | null>(null);
  deskRef.current = desk;

  const applyDesk = useCallback((view: PickDeskView) => {
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
  }, []);

  const load = useCallback(() => {
    void (async () => {
      const cacheOrg = orgId?.trim() || "_";
      let hadCache = Boolean(deskRef.current);
      try {
        const cached = await getFeatureSnapshot<PickDeskView>("pick-desk", cacheOrg);
        if (!deskRef.current && cached?.data && isPickDeskView(cached.data)) {
          applyDesk(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          setLoading(false);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
      try {
        const response = await fetch(`/api/strategy/pick-desk${qs}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = await response.json();
        if (response.status === 401 || response.status === 403) {
          setDesk(null);
          setFromCache(false);
          setCachedAt(null);
          setSetupMessage("");
          setFetchFailed(true);
          void clearFeatureSnapshot("pick-desk", cacheOrg);
          if (orgId) void clearFeatureSnapshot("pick-desk", orgId);
          return;
        }
        if (data.status === "setup_required") {
          if (hadCache || deskRef.current) {
            setFromCache(true);
            setStatus("Could not refresh Pick desk. Showing the last copy on this device.");
            return;
          }
          setDesk(null);
          setSetupMessage(typeof data.message === "string" ? data.message : "Needs setup");
          setSetupOrgId(typeof data.orgId === "string" ? data.orgId : orgId);
          setSetupEventKey(typeof data.eventKey === "string" ? data.eventKey : null);
          return;
        }
        if (!response.ok || !isPickDeskView(data)) {
          if (hadCache || deskRef.current) {
            setFromCache(true);
            setStatus("Could not refresh Pick desk. Showing the last copy on this device.");
            return;
          }
          setFetchFailed(true);
          return;
        }
        const view = data as PickDeskView;
        applyDesk(view);
        setFromCache(false);
        setCachedAt(null);
        const persistOrg = view.orgId || orgId;
        if (persistOrg) {
          try {
            await putFeatureSnapshot("pick-desk", persistOrg, view);
            if (!orgId) await putFeatureSnapshot("pick-desk", "_", view);
          } catch {
            // Live desk already painted; IndexedDB is best-effort.
          }
        }
      } catch {
        if (hadCache || deskRef.current) {
          setFromCache(true);
          setStatus("Could not refresh Pick desk. Showing the last copy on this device.");
          return;
        }
        setDesk(null);
        setSetupMessage("");
        setFetchFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [applyDesk, orgId]);

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
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
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
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
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
              ? setupMessage
              : undefined
        }
        onRetry={shell === "error" ? () => load() : undefined}
        embedded={embedded}
      >
        <OfflineBanner feature="Pick desk" fromCache={fromCache} cachedAt={cachedAt} />
      </PickDeskShell>
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

  return (
    <section
      className={`strategy-pick-desk pick-desk-workbench${embedded ? " embedded" : ""}`}
      aria-label="Pick list workbench"
    >
      <OfflineBanner feature="Pick desk" fromCache={fromCache} cachedAt={cachedAt} />
      <DataSourceDegradedBanner health={desk.dataSourceHealth} compact />
      <header className="pick-desk-heading">
        <div>
          {desk.pickMode === "low_data_tba" ? (
            <span className="app-badge setup">Need more scouting</span>
          ) : (
            <span className="app-badge good">From our scouting</span>
          )}
          <h2 style={{ marginTop: 8 }}>Rank, pick, and lock</h2>
          <p className="app-muted">
            {desk.eventName ?? desk.eventKey}
            {" · "}
            {formatPickDeskMetric(desk.candidates.length, true)} teams
            {desk.scoutedTeams > 0
              ? ` · ${formatPickDeskMetric(desk.scoutedTeams, true)} with our notes`
              : ""}
          </p>
        </div>
        <div className="strategy-pick-actions">
          <PickDeskRelatedStrip orgId={desk.orgId} />
          <Button variant="primary" type="button" onClick={saveList} disabled={saving}>
            {saving ? "Locking…" : "Lock this list"}
          </Button>
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
            Top calibrated scouts rotate into this pick-desk conversation so they see their product used.
          </small>
          {desk.canEdit ? (
            <Button variant="secondary" type="button" onClick={() => void seatTopScouts()} disabled={seating}>
              {seating ? "Seating…" : "Seat top scouts"}
            </Button>
          ) : null}
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
          <p className="app-muted">No saved lists yet — rank teams below, then lock.</p>
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
            Only teams at this event. Suggestions use your scouting when you have it.
          </small>
        </header>
        {!pool.length ? (
          <p className="app-muted">
            {desk.candidates.length
              ? "All listed teams are already on this pick list, or the filter hid them."
              : "No teams for this event yet — scout a few matches or wait for the event list."}
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
                    <em className="strategy-suggest muted">No suggestion yet</em>
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
