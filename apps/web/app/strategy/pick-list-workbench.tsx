"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CONSISTENCY_LABEL,
  describeDistribution,
  independenceLabel,
} from "@vantage/prediction-strategy";
import type { PickCandidate, PickTier } from "@vantage/prediction-strategy";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, Button, ConfirmDialog } from "../../components/ui";
import { useTierDrag } from "../../components/ui/use-tier-drag";
import "../../components/ui/tier-drag.css";
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
  type PickDeskNextAction,
  type PickDeskShellKind,
} from "../../lib/strategy/pick-desk-related";
import type { PickDeskCandidate, PickDeskEntry, PickDeskList, PickDeskView } from "../../lib/strategy/pick-desk";
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

type DeskTier = PickTier | "avoid";
function deskTier(tier: string | null): DeskTier {
  if (tier === "first" || tier === "first_pick") return "first";
  if (tier === "second" || tier === "second_pick") return "second";
  if (tier === "third") return "third";
  if (tier === "avoid" || tier === "do_not_pick") return "avoid";
  return "watch";
}
const TIERS: Array<{ id: DeskTier; label: string; hint: string }> = [
  { id: "first", label: "First picks", hint: "Alliance captains / first partners" },
  { id: "second", label: "Second picks", hint: "Partners who fill the gaps" },
  { id: "third", label: "Third picks", hint: "Backup, defense, climb" },
  { id: "watch", label: "Watch", hint: "Keep an eye on these" },
  { id: "avoid", label: "Avoid", hint: "Keep the team's exclusions visible" },
];

function teamLabel(entry: { teamKey: string; teamNumber?: number | null; nickname?: string | null }) {
  const number = entry.teamNumber ?? entry.teamKey.replace(/^frc/, "");
  return entry.nickname ? `${number} · ${entry.nickname}` : String(number);
}

/**
 * One line per team. "Our scouting" is the plain average of what our scouts
 * recorded (the same number as Robots); the public rating mixed with our
 * scouting, which orders this list, has its own label so the two are never
 * confused.
 */
function pickMetricLine(candidate: PickDeskCandidate | undefined) {
  if (!candidate) return "No numbers yet";
  const matches = candidate.scoutedMatches ?? 0;
  // What a strategist scans for; the full breakdown sits in the hover text (pickMetricDetail).
  const short = [
    candidate.scoutedAverage != null ? `${candidate.scoutedAverage.toFixed(1)} a match` : null,
    matches > 0 ? `${matches} scouted` : null,
    candidate.rank != null ? `rank ${candidate.rank}` : null,
  ].filter(Boolean);
  if (short.length) return short.join(" · ");
  return pickMetricDetail(candidate);
}

/** Every number we have for the team, in words: shown on hover. */
function pickMetricDetail(candidate: PickDeskCandidate | undefined) {
  if (!candidate) return "No numbers yet";
  const matches = candidate.scoutedMatches ?? 0;
  const parts = [
    candidate.scoutedAverage != null ? `Our scouting ${candidate.scoutedAverage.toFixed(1)} a match` : null,
    candidate.pepa != null
      ? `rating with our scouting ${candidate.pepa.toFixed(1)}${
          candidate.epa != null ? ` (public ${Number(candidate.epa).toFixed(1)})` : ""
        }`
      : candidate.epa != null
        ? `public rating ${Number(candidate.epa).toFixed(1)}`
        : null,
    candidate.record,
    candidate.rank != null ? `event rank ${candidate.rank}` : null,
    matches > 0 ? `${matches} ${matches === 1 ? "match" : "matches"} scouted` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "No numbers yet";
}

/**
 * Whether this team's results hold up beside weak partners — the question a
 * pick actually turns on, which rank and rating cannot answer. Hidden until the
 * event has enough played matches to split; the chip never guesses, and the
 * word carries the meaning so the colour is a second channel.
 */
function IndependenceChip({ candidate }: { candidate: PickCandidate | undefined }) {
  const verdict = candidate?.independence;
  if (!verdict || verdict.verdict === "unknown") return null;
  return (
    <span className={`pick-independence pick-independence-${verdict.verdict}`} title={verdict.summary}>
      {independenceLabel(verdict.verdict)}
    </span>
  );
}

/**
 * Whether the average is telling the truth.
 *
 * Two teams averaging ten points are not the same team: one scores ten every
 * match, the other nothing twice and twenty twice. A pick list that shows only
 * the average cannot tell them apart, and which one you want depends entirely
 * on whether you need a floor or a ceiling.
 *
 * Hidden below six matches. Quartiles of four matches are noise with decimal
 * places, and a confident "steady" from a sample that small is worse than
 * nothing, because somebody will pick on it. The hover carries the numbers.
 */
function ConsistencyChip({ candidate }: { candidate: PickCandidate | undefined }) {
  const shape = candidate?.consistency;
  if (!shape || shape.consistency === "unknown") return null;
  return (
    <span
      className={`pick-consistency pick-consistency-${shape.consistency}`}
      title={describeDistribution(shape)}
    >
      {CONSISTENCY_LABEL[shape.consistency]}
    </span>
  );
}

function PickDeskRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = pickDeskRelatedLinks(orgId, {
    include: [...PICK_DESK_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related pick-desk-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} href={link.href}>
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
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
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
  const copy = pickDeskShellCopy(shell, orgId);
  const setup = shell === "setup" ? pickDeskSetupSteps(orgId)[0] : null;
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  return (
    <section
      className={`strategy-pick-desk pick-desk-workbench soft-gate${embedded ? " embedded" : ""}`}
      aria-label="Pick list setup"
    >
      <header className="pick-desk-heading">
        <div>
          <h2 style={{ marginTop: 0 }}>Pick list</h2>
          <p className="app-muted">
            Order robots by tier, then save your list.
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
  onDirtyChange,
  onBusyChange,
}: {
  orgId: string | null;
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
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
  const savingRef = useRef(false);
  const seatingRef = useRef(false);
  const loadGeneration = useRef(0);
  const [pendingList, setPendingList] = useState<string | null>(null);
  const [saveNeedsReview, setSaveNeedsReview] = useState(false);
  const savedList = desk?.pickLists.find(list => list.id === activeListId);
  const canEditList = Boolean(desk?.canEdit) && (!savedList?.status || savedList.status === "open");
  const dirty = savedList ? draftName !== savedList.name || JSON.stringify(entries) !== JSON.stringify(savedList.entries) : entries.length > 0 || draftName !== "Alliance picks";
  const draftRef = useRef({ activeListId, draftName, entries, dirty });
  draftRef.current = { activeListId, draftName, entries, dirty };
  const deskRef = useRef<PickDeskView | null>(null);
  deskRef.current = desk;

  useEffect(() => {
    if (!desk) return;
    onDirtyChange?.(dirty);
  }, [desk, dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(saving || seating); }, [saving, seating, onBusyChange]);

  useEffect(() => {
    if (!embedded) return;
    const url = new URL(window.location.href);
    if (activeListId) url.searchParams.set("listId", activeListId);
    else if (desk) url.searchParams.delete("listId");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [activeListId, embedded, desk]);

  const applyDesk = useCallback((view: PickDeskView) => {
    if (draftRef.current.dirty && deskRef.current?.orgId === view.orgId) {
      // A cache refresh must not replace an open ranking or advance its base revision.
      setDesk({ ...view, pickLists: deskRef.current.pickLists });
      return;
    }
    setDesk(view);
    setSetupMessage("");
    setSetupOrgId(view.orgId);
    setSetupEventKey(view.eventKey);
      const preferredId = draftRef.current.activeListId ?? new URLSearchParams(window.location.search).get("listId");
      const preferred = view.pickLists.find((list) => list.id === preferredId) ?? view.pickLists[0];
      if (preferred) {
        setDraftName(preferred.name);
        setEntries(preferred.entries);
        setActiveListId(preferred.id);
        return;
      }
      setEntries([]);
      setDraftName("Alliance picks");
      setActiveListId(null);
  }, []);

  const load = useCallback(() => {
    const generation = ++loadGeneration.current;
    void (async () => {
      const cacheOrg = orgId?.trim() || "_";
      let hadCache = Boolean(deskRef.current);
      try {
        const cached = await getFeatureSnapshot<PickDeskView>("pick-desk", cacheOrg);
        if (generation !== loadGeneration.current) return;
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
      if (generation !== loadGeneration.current) return;
      setFetchFailed(false);
      const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
      try {
        const response = await fetch(`/api/strategy/pick-desk${qs}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = await response.json().catch(() => ({}));
        if (generation !== loadGeneration.current) return;
        if (response.status === 401 || response.status === 403) {
          setDesk(null);
          deskRef.current = null;
          setEntries([]); setDraftName("Alliance picks"); setActiveListId(null);
          setFromCache(false);
          setCachedAt(null);
          setSetupMessage("");
          setFetchFailed(true);
          void clearFeatureSnapshot("pick-desk", cacheOrg).catch(() => undefined);
          return;
        }
        if (data?.status === "setup_required") {
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
        if (generation !== loadGeneration.current) return;
        if (hadCache || deskRef.current) {
          setFromCache(true);
          setStatus("Could not refresh Pick desk. Showing the last copy on this device.");
          return;
        }
        setDesk(null);
        setSetupMessage("");
        setFetchFailed(true);
      } finally {
        if (generation === loadGeneration.current) setLoading(false);
      }
    })();
  }, [applyDesk, orgId]);

  useEffect(() => {
    load();
    return () => { loadGeneration.current += 1; };
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
    listCount: desk?.pickLists.length ?? 0,
  });

  const byKey = useMemo(() => {
    const map = new Map<string, PickDeskCandidate>();
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

  function entriesForTier(tier: DeskTier) {
    return entries
      .filter((entry) => deskTier(entry.tier) === tier)
      .sort((a, b) => a.rank - b.rank);
  }

  function reindex(next: PickDeskEntry[]) {
    const order = TIERS.flatMap((tier) => next.filter((entry) => deskTier(entry.tier) === tier.id));
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

  function moveEntry(teamKey: string, tier: DeskTier) {
    setEntries((current) =>
      reindex(current.map((entry) => (entry.teamKey === teamKey ? { ...entry, tier } : entry))),
    );
  }

  function removeEntry(teamKey: string) {
    setEntries((current) => reindex(current.filter((entry) => entry.teamKey !== teamKey)));
  }

  /** Move one team to slot `index` of a column (counted among the teams that stay), then renumber. */
  function placeEntry(current: PickDeskEntry[], teamKey: string, tier: DeskTier, index: number): PickDeskEntry[] {
    const moving = current.find((entry) => entry.teamKey === teamKey);
    if (!moving) return current;
    const columns = TIERS.map((item) => ({
      id: item.id,
      list: current
        .filter((entry) => entry.teamKey !== teamKey && deskTier(entry.tier) === item.id)
        .sort((a, b) => a.rank - b.rank),
    }));
    const target = columns.find((column) => column.id === tier);
    if (!target) return current;
    target.list.splice(Math.max(0, Math.min(index, target.list.length)), 0, { ...moving, tier });
    return columns.flatMap((column) => column.list).map((entry, position) => ({ ...entry, rank: position + 1 }));
  }

  // Drag a team between the columns (or up and down one with the arrow keys). Only people who can
  // edit the list get handles.
  const tierDrag = useTierDrag<DeskTier>({
    groups: TIERS.map((item) => ({ tier: item.id, ids: entriesForTier(item.id).map((entry) => entry.teamKey) })),
    enabled: canEditList,
    tierLabel: (tier) => TIERS.find((item) => item.id === tier)?.label ?? tier,
    onMove: (teamKey, tier, index) => setEntries((current) => placeEntry(current, teamKey, tier, index)),
  });

  async function saveList() {
    if (!desk || savingRef.current) return;
    if (!canEditList) {
      setStatus("Scouting lead or team administrator access is required to save rankings.");
      return;
    }
    savingRef.current = true;
    const submitted = { id: activeListId, name: draftName.trim() || "Alliance picks", entries };
    // Invalidate a read started before this write; it cannot replace the acknowledged list.
    loadGeneration.current += 1;
    setSaving(true);
    setStatus("Saving pick list…");
    setSaveNeedsReview(false);
    try {
    const response = await fetch("/api/intel/pick-lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId: desk.orgId,
        id: activeListId ?? undefined,
        baseRevision: savedList?.revision,
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
      revision?: number;
      error?: string;
      influence?: { attributed?: number; notified?: number };
    };
    if (response.ok && typeof data?.id === "string" && /^[0-9a-f-]{36}$/i.test(data.id) && Number.isSafeInteger(data.revision) && data.revision! > 0) {
      const attributed = data.influence?.attributed ?? 0;
      const notified = data.influence?.notified ?? 0;
      setStatus(
        attributed > 0
          ? `Pick list saved. Told ${notified} scout${notified === 1 ? "" : "s"} where ${attributed} entr${attributed === 1 ? "y" : "ies"} went.`
          : "Pick list saved. No scout entries to attribute yet.",
      );
      const saved: PickDeskList = { id: data.id, name: submitted.name, entries: submitted.entries, eventKey: desk.eventKey, updatedAt: null, revision: data.revision, status: "open" };
      setDesk(current => current ? { ...current, pickLists: [saved, ...current.pickLists.filter(list => list.id !== saved.id)] } : current);
      setActiveListId(saved.id);
      // Edits made while the save was in flight remain different from this saved baseline.
      if (draftRef.current.draftName === draftName) setDraftName(submitted.name);
      setFromCache(false); setCachedAt(null);
      void clearFeatureSnapshot("pick-desk", desk.orgId).catch(() => undefined);
      void clearFeatureSnapshot("picklist-collab", desk.orgId, saved.id).catch(() => undefined);
    } else {
      setSaveNeedsReview(true);
      setStatus(typeof data?.error === "string" ? data.error : "Save could not be confirmed. Your edits are still here. Check the saved list before retrying.");
    }
    } catch {
      setSaveNeedsReview(true);
      setStatus("Save could not be confirmed. Your edits are still here. Check the saved list before retrying.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function seatTopScouts() {
    if (seatingRef.current) return;
    if (!desk?.canEdit) {
      setStatus("Owner or admin role required to seat scouts.");
      return;
    }
    seatingRef.current = true;
    setSeating(true);
    setStatus("Seating top accurate scouts…");
    try {
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
    const confirmed = response.ok && Array.isArray(data?.strategySeats);
    setStatus(
      confirmed
        ? `Seated top accurate scouts into the pick-desk conversation (${data.strategySeats!.length} seat${data.strategySeats!.length === 1 ? "" : "s"}).`
        : data?.error ?? "Could not confirm scout seating",
    );
    if (confirmed) load();
    } catch { setStatus("Scout seating could not be confirmed. Refresh the list before retrying."); }
    finally { seatingRef.current = false; setSeating(false); }
  }

  function selectList(list: PickDeskList) {
    setActiveListId(list.id);
    setDraftName(list.name);
    setEntries(list.entries);
    setStatus("");
  }

  function chooseList(id: string) {
    if (!desk || savingRef.current) return;
    const list = desk.pickLists.find(item => item.id === id);
    if (list) selectList(list);
    else { setActiveListId(null); setDraftName("Alliance picks"); setEntries([]); setStatus(""); }
    setPendingList(null);
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
      <DataSourceDegradedBanner health={desk.dataSourceHealth} compact canOpenTeamData={desk.canEdit} />
      <header className="pick-desk-heading">
        <div>
          {desk.pickMode === "low_data_tba" ? (
            <span className="app-badge setup">Need more scouting</span>
          ) : (
            <span className="app-badge good">From our scouting</span>
          )}
          <h2 style={{ marginTop: 8 }}>Pick list</h2>
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
          {/* Only people who can save one see Save; a scout pressing it got "Owner or admin role
              required". */}
          {desk.canEdit ? (
            <Button variant="primary" type="button" onClick={saveList} disabled={saving || (savedList?.status !== undefined && savedList.status !== "open")}>
              {saving ? "Saving…" : "Save pick list"}
            </Button>
          ) : null}
        </div>
      </header>

      {desk.pickMode === "low_data_tba" ? (
        <p className="strategy-pick-coverage-hint app-muted" role="status">
          Thin scout depth —{" "}
          <a href={coverageHref}>open scout coverage</a> or add notes in Scouting before trusting pick
          explainability.
        </p>
      ) : null}


      <div className="strategy-pick-toolbar app-card">
        <label>
          List name
          <input value={draftName} disabled={!canEditList} maxLength={200} onChange={(event) => setDraftName(event.target.value)} />
        </label>
        <label>
          Filter pool
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Team # or nickname"
          />
        </label>
        <label className="strategy-saved-list-select">
          Saved list
          <select aria-label="Saved pick list" disabled={saving} value={activeListId ?? ""} onChange={event => {
            if (dirty) setPendingList(event.target.value);
            else chooseList(event.target.value);
          }}>
            <option value="">{desk.canEdit ? "New pick list" : "No list selected"}</option>
            {desk.pickLists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
        </label>
        {!desk.canEdit ? (
          <p className="telemetry-status" role="status">
            Scouting leads and team administrators save rankings. You can review the list and contribute in Team discussion.
          </p>
        ) : null}
        {status ? (
          <p className="telemetry-status" role="status">
            {status}
          </p>
        ) : null}
        {saveNeedsReview ? <Button as="a" variant="secondary" href={withOrgHref(`/competition?tab=picks&view=discussion${activeListId ? `&listId=${encodeURIComponent(activeListId)}` : ""}`, desk.orgId)} target="_blank" rel="noopener noreferrer">Check shared list in a new tab</Button> : null}
      </div>

      {savedList?.status && savedList.status !== "open" ? <p role="status" className="app-muted">This list is {savedList.status}. Reopen it in Team discussion before editing.</p> : null}
      <ConfirmDialog open={pendingList !== null} opts={{ title: "Discard unsaved ranking changes?", body: "Switching lists will discard the changes in this ranking. Keep editing to save them first.", confirmLabel: "Discard and switch", cancelLabel: "Keep editing" }} onResolve={ok => { if (ok && pendingList !== null) chooseList(pendingList); else setPendingList(null); }} />

      <div className="strategy-pick-columns" ref={tierDrag.rootRef}>
        <p className="sr-only" role="status" aria-live="polite">
          {tierDrag.announcement}
        </p>
        {TIERS.map((tier) => {
          const column = entriesForTier(tier.id);
          const slot = tierDrag.slotIndex(tier.id);
          const rows: ReactNode[] = [];
          let stay = 0;
          for (const entry of column) {
            const dragged = tierDrag.drag?.id === entry.teamKey;
            if (!dragged && slot === stay) rows.push(<li key="drop-slot" className="tier-drop-slot" aria-hidden="true" />);
            if (!dragged) stay += 1;
            const candidate = byKey.get(entry.teamKey);
            const hasHeat = Boolean(desk.positionHeatByTeam?.[entry.teamKey]?.length);
            const heatButton = hasHeat ? (
              <button
                type="button"
                aria-expanded={heatOpenFor === entry.teamKey}
                onClick={() => setHeatOpenFor((current) => (current === entry.teamKey ? null : entry.teamKey))}
              >
                {heatOpenFor === entry.teamKey ? "Hide heat" : "Heat"}
              </button>
            ) : null;
            rows.push(
              <li key={entry.teamKey} data-entry-id={entry.teamKey} className={dragged ? "is-dragging" : undefined}>
                <div className="strategy-pick-row-head">
                  {canEditList ? (
                    <button
                      type="button"
                      className="tier-drag-handle"
                      aria-label={`Move team ${entry.teamNumber ?? entry.teamKey}: drag, or press the up and down arrow keys`}
                      {...tierDrag.handleProps(entry.teamKey, tier.id)}
                    >
                      <span aria-hidden="true">⋮⋮</span>
                    </button>
                  ) : null}
                  <div>
                    <strong>
                      #{entry.rank} {teamLabel(entry)}
                    </strong>
                    <small title={pickMetricDetail(candidate)}>{pickMetricLine(candidate)}</small>
                    <IndependenceChip candidate={candidate} />
                    <ConsistencyChip candidate={candidate} />
                  </div>
                  <div className="strategy-pick-row-actions">
                    {canEditList ? (
                      <details className="tier-row-more">
                        <summary aria-label={`More for team ${entry.teamNumber ?? entry.teamKey}`}>More</summary>
                        <div className="tier-row-more-panel">
                          <span className="app-muted">Move to</span>
                          <div className="tier-row-more-actions">
                            {TIERS.filter((item) => item.id !== tier.id).map((item) => (
                              <button key={item.id} type="button" onClick={() => moveEntry(entry.teamKey, item.id)}>
                                {item.label.replace(" picks", "")}
                              </button>
                            ))}
                          </div>
                          <div className="tier-row-more-actions">
                            {heatButton}
                            <button type="button" onClick={() => removeEntry(entry.teamKey)}>
                              Remove
                            </button>
                          </div>
                        </div>
                      </details>
                    ) : (
                      heatButton
                    )}
                  </div>
                </div>
                {heatOpenFor === entry.teamKey && desk.positionHeatByTeam?.[entry.teamKey] ? (
                  <PositionHeatPanel heatmaps={desk.positionHeatByTeam[entry.teamKey]!} />
                ) : null}
              </li>,
            );
          }
          if (slot !== null && stay <= slot) rows.push(<li key="drop-slot" className="tier-drop-slot" aria-hidden="true" />);
          return (
            <article key={tier.id} className="app-card strategy-pick-column">
              <header>
                <h3>{tier.label}</h3>
                <small>{tier.hint}</small>
              </header>
              <ul data-tier-list={tier.id}>
                {rows}
                {!column.length ? (
                  <li className="strategy-pick-empty">
                    Add teams from the pool below
                    {canEditList ? ", or drag one here" : ""}.
                  </li>
                ) : null}
              </ul>
            </article>
          );
        })}
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
                  <small title={pickMetricDetail(candidate)}>{pickMetricLine(candidate)}</small>
                  <IndependenceChip candidate={candidate} />
                  <ConsistencyChip candidate={candidate} />
                  {candidate.suggestedTier ? (
                    <em className="strategy-suggest">Suggested {candidate.suggestedTier}</em>
                  ) : (
                    <em className="strategy-suggest muted">No suggestion yet</em>
                  )}
                </div>
                <div className="strategy-pick-row-actions">
                  {canEditList ? (
                    <button
                      type="button"
                      className="strategy-pool-add"
                      title={`Adds to ${TIERS.find((item) => item.id === (candidate.suggestedTier ?? "watch"))?.label ?? "Watch"}; drag it to move it later`}
                      onClick={() => addToTier(candidate, (candidate.suggestedTier ?? "watch") as PickTier)}
                    >
                      Add to {(TIERS.find((item) => item.id === (candidate.suggestedTier ?? "watch"))?.label ?? "Watch").replace(" picks", "")}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

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

      <PickDeskNextActionsPanel actions={readyActions} />
    </section>
  );
}
