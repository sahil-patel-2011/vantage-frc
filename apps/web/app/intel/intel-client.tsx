"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  UsageCutoffBanner,
  resolveCutoffErrorCode,
} from "../../components/usage-cutoff-banner";
import { EmptyState, PageHeader, Skeleton } from "../../components/ui";
import {
  classifyIntelShell,
  intelNextActions,
  INTEL_PAGE_DESCRIPTION,
  intelShellCopy,
  type IntelActiveEvent,
  type IntelScoutNote,
} from "../../lib/intel/intel-related";
import {
  FEATURE_API_TIMEOUT_MS,
  fetchActiveOrgId,
  persistOrgIdInUrl,
  readOrgIdFromSearch,
} from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { IntelRelatedStrip, IntelShell } from "./intel-chrome";
import {
  IntelLookupForm,
  IntelReadyView,
  IntelSearchResults,
  IntelEventRoster,
  type IntelRosterTeam,
  type IntelCompareResult,
  type IntelDetail,
  type IntelSearchTeam,
} from "./intel-ready-view";
import { DataSourcePicker } from "../analytics/data-source-picker";
import { useAnalyticsSource } from "../../lib/analytics/use-analytics-source";
import { filterRowsBySource } from "../../lib/analytics/lovat-data-source";
import { SharedScoutObservations } from "./shared-scout-observations";
import { parseLookupNote, type LookupNote } from "../../lib/intel/lookup-notes";
import {
  loadRoster,
  loadTeamResponse,
  saveRoster,
  saveTeamResponse,
  searchRosterOffline,
} from "../../lib/intel/offline-teams";
import type { EventRatingRow } from "../../lib/intel/lovat-lookup";
import { classifyLookupFailure, teamSearchEmptyCopy } from "../../lib/intel/team-search";
import { useAppleMotion } from "../../lib/motion/use-apple-motion";
import "./intel.css";

type IntelBoardView = {
  intel: IntelDetail;
  similar: Array<IntelSearchTeam & { epaTotal: number }>;
  scoutNotes: IntelScoutNote[];
  activeEvent: IntelActiveEvent | null;
  fieldRatings?: EventRatingRow[];
  lookupNote?: LookupNote | null;
};

function isIntelBoardView(value: unknown): value is IntelBoardView {
  if (!value || typeof value !== "object") return false;
  const row = value as { intel?: { team?: { teamNumber?: unknown } } };
  return typeof row.intel?.team?.teamNumber === "number";
}

type TeamResponse = {
  team?: IntelDetail;
  similarTeams?: Array<IntelSearchTeam & { epaTotal: number }>;
  scoutObservations?: IntelScoutNote[];
  activeEvent?: IntelActiveEvent | null;
  fieldRatings?: EventRatingRow[];
  lookupNote?: unknown;
  error?: string;
};

/** One shape for a live response and a saved one (lib/intel/offline-teams.ts). */
function boardFromTeamResponse(data: TeamResponse, fallbackEvent: IntelActiveEvent | null): IntelBoardView | null {
  if (!data.team) return null;
  return {
    intel: data.team,
    similar: data.similarTeams ?? [],
    scoutNotes: data.scoutObservations ?? [],
    activeEvent: data.activeEvent ?? fallbackEvent,
    fieldRatings: Array.isArray(data.fieldRatings) ? data.fieldRatings : [],
    lookupNote: parseLookupNote(
      data.lookupNote ?? null,
      data.team.team.teamKey,
      Boolean((data.lookupNote as { canEdit?: boolean } | null)?.canEdit),
    ),
  };
}

async function persistIntelSnapshot(orgHint: string, data: IntelBoardView): Promise<void> {
  const cacheOrg = orgHint.trim() || "_";
  try {
    await putFeatureSnapshot("intel", cacheOrg, data);
    if (!orgHint.trim()) await putFeatureSnapshot("intel", "_", data);
  } catch {
    // Live Research already painted; IndexedDB is best-effort.
  }
}

/**
 * `variant="scouting"` is Scouting's Teams tab: titled "Teams", what our scouts saw first, and the
 * data-source controls folded under the team card instead of between the search and the team.
 */
export default function IntelClient({ variant = "vantage", embedded = false }: { variant?: "vantage" | "scouting"; embedded?: boolean } = {}) {
  const [orgId, setOrgId] = useState("");
  const [orgReady, setOrgReady] = useState(false);

  useEffect(() => {
    const fromUrl = readOrgIdFromSearch(window.location.search);
    if (fromUrl) {
      setOrgId(fromUrl);
      setOrgReady(true);
      return;
    }
    void fetchActiveOrgId().then((id) => {
      if (id) {
        persistOrgIdInUrl(id);
        setOrgId(id);
      }
      setOrgReady(true);
    });
  }, []);

  if (!orgReady) {
    return <IntelShell orgId={null} shell="loading" embedded={embedded} />;
  }
  if (!orgId) {
    return <IntelShell orgId={null} shell="setup" embedded={embedded} />;
  }
  return <IntelLive orgId={orgId} variant={variant} embedded={embedded} />;
}

/** The open team in the address, so Back, reload and a shared link keep it. */
function rememberTeamInUrl(teamNumber: number | null) {
  try {
    const url = new URL(window.location.href);
    if (teamNumber) url.searchParams.set("team", String(teamNumber));
    else url.searchParams.delete("team");
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // Some embedded browsers refuse history writes; the page still works.
  }
}

function IntelLive({ orgId, variant, embedded }: { orgId: string; variant: "vantage" | "scouting"; embedded: boolean }) {
  const Container = embedded ? "section" : "main";
  const scouting = variant === "scouting";
  const motion = useAppleMotion();
  const source = useAnalyticsSource(orgId);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IntelSearchTeam[]>([]);
  const [roster, setRoster] = useState<IntelRosterTeam[]>([]);
  const [view, setView] = useState<IntelBoardView | null>(null);
  const [summary, setSummary] = useState("");
  const [compare, setCompare] = useState("");
  const [comparison, setComparison] = useState<IntelCompareResult | null>(null);
  const [pickName, setPickName] = useState("Primary pick list");
  const [status, setStatus] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("error");
  // Write a brief / Find public notes answer under their own buttons: the page-top status sat a
  // screen away from the button, so a student pressed it and saw nothing happen.
  const [actionNote, setActionNote] = useState<{ text: string; kind: "working" | "success" | "error"; aiOff?: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  // A search in flight, and what the last finished search found nothing for. While either is
  // set the previous team's board steps aside, so 3091 no longer sits there looking like the
  // answer to "254".
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  // One lookup at a time: a newer search or team tap cancels the older request.
  const lookupAbortRef = useRef<AbortController | null>(null);
  const viewRef = useRef<IntelBoardView | null>(null);
  viewRef.current = view;

  function startLookup(): { controller: AbortController; signal: AbortSignal } {
    lookupAbortRef.current?.abort();
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    return { controller, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]) };
  }

  useEffect(() => () => lookupAbortRef.current?.abort(), []);

  const chemistryHref = comparison
    ? withOrgHref(
        `/chemistry?teams=${comparison.teams.map((t) => t.teamNumber).join(",")}`,
        orgId,
      )
    : withOrgHref("/chemistry", orgId);

  useEffect(() => {
    void (async () => {
      try {
        const cached = await getFeatureSnapshot<IntelBoardView>("intel", orgId || "_");
        if (!viewRef.current && cached?.data && isIntelBoardView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
        }
      } catch {
        // IndexedDB missing or blocked; live lookup still runs.
      }
    })();
  }, [orgId]);

  // ?team=254 opens that team directly (links from Scouting's home and from
  // anywhere that names a team).
  useEffect(() => {
    const team = Number(new URLSearchParams(window.location.search).get("team"));
    if (Number.isInteger(team) && team > 0) void select(team);
    // Once, on arrival.
  }, []);

  // The event's teams, so the page opens on something to tap. Best effort:
  // search still works when this fails or there is no active event.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      // The saved list first, so a pit with no signal still opens on the event's teams.
      const saved = await loadRoster(orgId);
      if (!cancelled && saved?.roster.length) setRoster(saved.roster);
      try {
        const response = await fetch(`/api/intel/teams?orgId=${orgId}&q=`, {
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        if (!response.ok) return;
        const data = (await response.json()) as { roster?: IntelRosterTeam[] };
        if (!cancelled && Array.isArray(data.roster)) {
          setRoster(data.roster);
          void saveRoster(orgId, data.roster);
        }
      } catch {
        // Offline or slow — the saved list (if any) and the search box are still there.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  async function search(event: FormEvent) {
    event.preventDefault();
    const asked = query.trim();
    if (!asked) return;
    const { controller, signal } = startLookup();
    // The previous answer is stale the moment a new search starts.
    setResults([]);
    setNotFound(null);
    setSearching(true);
    setStatus("");
    setFetchFailed(false);
    setErrorStatus(null);
    setCutoffCode(null);
    try {
      const response = await fetch(`/api/intel/teams?orgId=${orgId}&q=${encodeURIComponent(asked)}`, { signal });
      const data = (await response.json()) as {
        teams?: IntelSearchTeam[];
        activeEvent?: IntelActiveEvent | null;
        error?: string;
      };
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setErrorStatus(response.status);
        setStatus(data.error ?? "Could not search teams. Try again.");
        setMessageKind("error");
        return;
      }
      const teams = data.teams ?? [];
      setResults(teams);
      setNotFound(teams.length ? null : teamSearchEmptyCopy(asked));
      if (data.activeEvent) {
        setView((current) => (current ? { ...current, activeEvent: data.activeEvent ?? current.activeEvent } : current));
      }
      setStatus("");
      setMessageKind("success");
    } catch (error) {
      const failure = classifyLookupFailure(error, {
        superseded: controller.signal.aborted,
        online: typeof navigator === "undefined" || navigator.onLine !== false,
      });
      if (failure === "superseded") return;
      if (failure === "timeout") {
        // Slow is not offline: say so and leave the search box ready for another try.
        setStatus("Search is taking longer than usual. Try again in a moment.");
        setMessageKind("error");
        return;
      }
      // No signal (or the connection dropped): search the event's saved team list instead.
      const saved = roster.length ? roster : ((await loadRoster(orgId))?.roster ?? []);
      if (lookupAbortRef.current !== controller) return;
      const matches = searchRosterOffline(saved, asked).map((team) => ({
        teamKey: team.teamKey,
        teamNumber: team.teamNumber,
        nickname: team.nickname,
        city: null,
        stateProv: null,
        atActiveEvent: true,
      }));
      setResults(matches);
      if (saved.length) {
        setNotFound(matches.length ? null : teamSearchEmptyCopy(asked, { offline: true }));
        setStatus(matches.length ? "Offline — searched this event's teams saved on this device." : "");
        setMessageKind("success");
      } else {
        setStatus(
          failure === "offline"
            ? "You're offline and this device has no saved team list yet. Search again when you're back online."
            : "Couldn't reach Vantage. Check your connection and try again.",
        );
        setMessageKind("error");
      }
    } finally {
      if (lookupAbortRef.current === controller) setSearching(false);
    }
  }

  /** Back to the open team after a search: drops the search answer, keeps the board. */
  function clearSearch() {
    lookupAbortRef.current?.abort();
    setResults([]);
    setNotFound(null);
    setSearching(false);
    setStatus("");
  }

  /** No signal, or the lookup failed: show this team as saved on the device, if it is. */
  async function showSavedTeam(teamNumber: number): Promise<boolean> {
    const saved = await loadTeamResponse<TeamResponse>(orgId, teamNumber);
    const board = saved ? boardFromTeamResponse(saved.data, viewRef.current?.activeEvent ?? null) : null;
    if (!saved || !board) return false;
    setView(board);
    setResults([]);
    setNotFound(null);
    setSummary("");
    setComparison(null);
    setFromCache(true);
    setCachedAt(saved.cachedAt);
    setFetchFailed(false);
    setStatus(`Offline — Team ${teamNumber} as saved on this device.`);
    setMessageKind("success");
    return true;
  }

  async function select(teamNumber: number) {
    const { controller, signal } = startLookup();
    setSearching(false);
    setStatus(`Loading Team ${teamNumber}…`);
    setMessageKind("success");
    setLoadingTeam(true);
    setFetchFailed(false);
    setErrorStatus(null);
    setCutoffCode(null);
    // "Showing the last copy" is only true when the board on screen is this same team.
    const sameTeam = () => viewRef.current?.intel.team.teamNumber === teamNumber;
    try {
      const response = await fetch(`/api/intel/teams?orgId=${orgId}&team=${teamNumber}`, { signal });
      const data = (await response.json()) as TeamResponse & { notFound?: boolean };
      if (controller.signal.aborted) return;
      if (response.ok && !data.team && data.notFound) {
        // Not in Vantage's shared team list: a plain answer, not "could not refresh".
        setResults([]);
        setNotFound(teamSearchEmptyCopy(String(teamNumber)));
        setStatus("");
        if (!sameTeam()) rememberTeamInUrl(viewRef.current?.intel.team.teamNumber ?? null);
        return;
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setView(null);
          setFromCache(false);
          setCachedAt(null);
          setFetchFailed(true);
          setErrorStatus(response.status);
          setStatus(data.error ?? "Could not load team");
          setMessageKind("error");
          void clearFeatureSnapshot("intel", orgId || "_");
          return;
        }
        if (await showSavedTeam(teamNumber)) return;
        if (sameTeam()) {
          setFromCache(true);
          setStatus("Could not refresh this team. Showing the last copy on this device.");
          setFetchFailed(false);
        } else if (viewRef.current) {
          setStatus(data.error ?? `Could not load Team ${teamNumber}. Try again.`);
        } else {
          setErrorStatus(response.status);
          setFetchFailed(true);
          setStatus(data.error ?? "Could not load team");
        }
        setMessageKind("error");
        return;
      }
      if (!data.team) {
        if (sameTeam()) {
          setFromCache(true);
          setStatus("Could not refresh this team. Showing the last copy on this device.");
          setFetchFailed(false);
        } else if (viewRef.current) {
          setStatus(`Could not load Team ${teamNumber}. Try again.`);
        } else {
          setFetchFailed(true);
          setStatus("Could not load team");
        }
        setMessageKind("error");
        return;
      }
      const next = boardFromTeamResponse(data, viewRef.current?.activeEvent ?? null)!;
      void saveTeamResponse(orgId, teamNumber, data);
      rememberTeamInUrl(teamNumber);
      setView(next);
      setResults([]);
      setNotFound(null);
      setSummary("");
      setComparison(null);
      setStatus("");
      setMessageKind("success");
      setFromCache(false);
      setCachedAt(null);
      await persistIntelSnapshot(orgId, next);
    } catch (error) {
      const failure = classifyLookupFailure(error, {
        superseded: controller.signal.aborted,
        online: typeof navigator === "undefined" || navigator.onLine !== false,
      });
      if (failure === "superseded") return;
      if (failure !== "timeout" && (await showSavedTeam(teamNumber))) return;
      if (lookupAbortRef.current !== controller) return;
      if (sameTeam()) {
        setFromCache(true);
        setStatus(
          failure === "timeout"
            ? "This team is taking longer than usual to refresh. Showing the last copy on this device."
            : "Could not refresh this team. Showing the last copy on this device.",
        );
        setFetchFailed(false);
      } else if (viewRef.current) {
        setStatus(
          failure === "timeout"
            ? `Team ${teamNumber} is taking longer than usual to load. Try again in a moment.`
            : `Could not load Team ${teamNumber} — check your connection and try again.`,
        );
      } else {
        setFetchFailed(true);
        setStatus(failure === "timeout" ? "This is taking longer than usual. Try again in a moment." : "Network error — please try again.");
      }
      setMessageKind("error");
    } finally {
      if (lookupAbortRef.current === controller) setLoadingTeam(false);
    }
  }

  async function action(path: string, label: string) {
    if (!view) return;
    setActionNote({ text: label, kind: "working" });
    setCutoffCode(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        body: JSON.stringify({ orgId, teamNumber: view.intel.team.teamNumber }),
      });
      const data = (await response.json()) as {
        summary?: string;
        error?: string;
        code?: string;
        reason?: string;
      };
      const cutoff = resolveCutoffErrorCode(response.status, data);
      if (cutoff) {
        setCutoffCode(cutoff);
        setActionNote({ text: data.error ?? "Research paused until this team has credits.", kind: "error" });
        return;
      }
      if (path.includes("summary") && data.summary) setSummary(data.summary);
      if (response.ok) {
        setActionNote(path.includes("research") ? { text: "Public notes updated.", kind: "success" } : null);
      } else {
        setActionNote({
          text: data.error ?? "That didn't work. Try again.",
          kind: "error",
          aiOff: data.code === "setup_required",
        });
      }
      if (response.ok && path.includes("research")) await select(view.intel.team.teamNumber);
    } catch {
      setActionNote({ text: "No connection. Try again.", kind: "error" });
    }
  }

  async function runComparison(event: FormEvent) {
    event.preventDefault();
    const numbers = compare
      .split(/[,\s]+/)
      .map(Number)
      .filter(Number.isInteger);
    if (view && !numbers.includes(view.intel.team.teamNumber)) numbers.unshift(view.intel.team.teamNumber);
    setSubmitting(true);
    setCutoffCode(null);
    try {
      const response = await fetch("/api/intel/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        body: JSON.stringify({ orgId, teamNumbers: numbers.slice(0, 3) }),
      });
      const data = (await response.json()) as IntelCompareResult & { error?: string };
      setComparison(response.ok ? (data as IntelCompareResult) : null);
      setStatus(response.ok ? "" : data.error ?? "Compare failed");
      setMessageKind(response.ok ? "success" : "error");
    } catch {
      setComparison(null);
      setStatus("Network error — please try again.");
      setMessageKind("error");
    } finally {
      setSubmitting(false);
    }
  }

  const savePick = useCallback(async () => {
    if (!view) return;
    if (!view.activeEvent?.eventKey) {
      setStatus("Set your active event before saving a pick.");
      setMessageKind("error");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/intel/pick-lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        body: JSON.stringify({
          orgId,
          eventKey: view.activeEvent.eventKey,
          name: pickName,
          entries: [{ teamKey: view.intel.team.teamKey, rank: 1, tier: "review" }],
        }),
      });
      const data = (await response.json()) as { error?: string };
      setStatus(response.ok ? `Saved ${view.intel.team.teamNumber} to ${pickName}.` : data.error ?? "Save failed");
      setMessageKind(response.ok ? "success" : "error");
    } catch {
      setStatus("Network error — please try again.");
      setMessageKind("error");
    } finally {
      setSubmitting(false);
    }
  }, [orgId, pickName, view]);

  const saveNote = useCallback(
    async (body: string) => {
      if (!view) return;
      setSubmitting(true);
      try {
        const response = await fetch("/api/intel/lookup-notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          body: JSON.stringify({ orgId, teamKey: view.intel.team.teamKey, body }),
        });
        const data = (await response.json()) as { note?: unknown; error?: string };
        if (!response.ok) {
          setStatus(data.error ?? "Could not save note");
          setMessageKind("error");
          return;
        }
        setView({
          ...view,
          lookupNote: parseLookupNote(data.note ?? { body }, view.intel.team.teamKey, true),
        });
        setStatus("Note saved.");
        setMessageKind("success");
      } catch {
        setStatus("Network error — please try again.");
        setMessageKind("error");
      } finally {
        setSubmitting(false);
      }
    },
    [orgId, view],
  );

  const shell = classifyIntelShell({
    loading: loadingTeam && !view,
    fetchFailed: fetchFailed && !view && results.length === 0,
    orgId,
    hasSelectedTeam: view != null,
  });

  if (!view) {
    if (shell === "loading" || shell === "error") {
      return (
        <IntelShell
          embedded={embedded}
          orgId={orgId}
          shell={shell}
          error={shell === "error" ? status || "Could not load Research." : undefined}
          errorStatus={errorStatus}
          onRetry={
            shell === "error"
              ? () => {
                  setFetchFailed(false);
                  setErrorStatus(null);
                  setStatus("");
                }
              : undefined
          }
        />
      );
    }
  }

  // A search in flight or its answer on screen: the open team's board steps aside (a Back link
  // brings it back), so it is never mistaken for the answer to the new search.
  const boardAside = searching || results.length > 0 || notFound != null;
  const findingCount = view?.intel.findings.length ?? 0;
  const readyActions = intelNextActions({
    orgId,
    shell,
    teamNumber: view?.intel.team.teamNumber ?? null,
    findingCount,
    scoutNoteCount: view?.scoutNotes.length ?? 0,
  });
  const emptyCopy = intelShellCopy("empty");

  return (
    <Container className={`module-page intel-page ${embedded ? "is-embedded" : ""} ${motion.classNames.page}`}>
      {embedded ? null : <PageHeader
        breadcrumbs={scouting ? "Scouting / Teams" : "Competition / Research"}
        title={scouting ? "Teams" : "Research"}
        description={
          scouting
            ? "Every team at your event: what our scouts saw first, then season numbers."
            : INTEL_PAGE_DESCRIPTION
        }
      >
        <IntelRelatedStrip orgId={orgId} teamNumber={view?.intel.team.teamNumber ?? null} />
      </PageHeader>}
      <OfflineBanner feature="Research" fromCache={fromCache} cachedAt={cachedAt} />

      {cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      <IntelLookupForm query={query} onQueryChange={setQuery} onSearch={search} />

      {status ? (
        <div className={`telemetry-status${messageKind === "success" ? " success" : ""}`} role="status">
          {status}
        </div>
      ) : null}

      {searching ? <IntelSearchSkeleton query={query.trim()} /> : null}

      {notFound ? (
        <p className="intel-empty intel-not-found" role="status">
          {notFound}
        </p>
      ) : null}

      <IntelSearchResults results={results} onSelect={(teamNumber) => void select(teamNumber)} />

      {view && boardAside && !searching ? (
        <button type="button" className="text-button intel-roster-back" onClick={clearSearch}>
          ← Back to Team {view.intel.team.teamNumber}
        </button>
      ) : null}

      {!view && !searching && results.length === 0 && roster.length > 0 ? (
        <IntelEventRoster roster={roster} onSelect={(teamNumber) => void select(teamNumber)} />
      ) : null}

      {shell === "empty" && !searching && !notFound && results.length === 0 && roster.length === 0 ? (
        <EmptyState
          soft
          badge={emptyCopy.badge}
          badgeTone="setup"
          title={emptyCopy.title}
          description={emptyCopy.description}
        />
      ) : null}

      {shell === "ready" && view && !boardAside ? (
        <>
          {roster.length > 0 ? (
            <button
              type="button"
              className="text-button intel-roster-back"
              onClick={() => {
                setView(null);
                setResults([]);
                setNotFound(null);
                setSummary("");
                setComparison(null);
                rememberTeamInUrl(null);
              }}
            >
              ← All {roster.length} teams at your event
            </button>
          ) : null}
          {scouting ? null : (
            <DataSourcePicker
              settings={source.settings}
              ownTeamKey={null}
              busy={source.busy}
              onMode={source.setMode}
              onTeams={source.setTeams}
              onEvents={source.setEvents}
            />
          )}
          <IntelReadyView
            scoutingFirst={scouting}
            intel={view.intel}
            similar={view.similar}
            summary={summary}
            compare={compare}
            comparison={comparison}
            pickName={pickName}
            toolsOpen={toolsOpen}
            submitting={submitting}
            scoutNotes={view.scoutNotes}
            activeEvent={view.activeEvent}
            readyActions={readyActions}
            chemistryHref={chemistryHref}
            fieldRatings={filterRowsBySource(
              (view.fieldRatings ?? []).map((row) => ({ ...row, eventKey: view.activeEvent?.eventKey ?? null })),
              source.settings,
              null,
            )}
            lookupNote={view.lookupNote ?? parseLookupNote(null, view.intel.team.teamKey, false)}
            onSaveNote={(body) => void saveNote(body)}
            actionNote={actionNote}
            onWriteBrief={() => void action("/api/intel/summary", "Writing a brief…")}
            onFindNotes={() => void action("/api/research", "Looking up public notes…")}
            onToggleTools={() => setToolsOpen((open) => !open)}
            onCompareChange={setCompare}
            onCompare={runComparison}
            onPickNameChange={setPickName}
            onSavePick={() => void savePick()}
            onSelectSimilar={(teamNumber) => void select(teamNumber)}
          />
          <SharedScoutObservations key={orgId + view.intel.team.teamKey + view.activeEvent?.eventKey} orgId={orgId} teamKey={view.intel.team.teamKey} eventKey={view.activeEvent?.eventKey ?? null} />
          {scouting ? (
            <details className="intel-source-more">
              <summary data-disclosure>Compare against other teams or events</summary>
              <DataSourcePicker
                settings={source.settings}
                ownTeamKey={null}
                busy={source.busy}
                onMode={source.setMode}
                onTeams={source.setTeams}
                onEvents={source.setEvents}
              />
            </details>
          ) : null}
        </>
      ) : null}
    </Container>
  );
}

/** Placeholder cards while a search runs, shaped like the result cards that replace them. */
function IntelSearchSkeleton({ query }: { query: string }) {
  return (
    <section className="intel-results intel-results-loading" aria-busy="true" aria-label="Searching teams">
      <span className="intel-visually-hidden" role="status">
        {query ? `Searching for ${query}…` : "Searching…"}
      </span>
      {[0, 1, 2].map((index) => (
        <div key={index} className="intel-result-skeleton" aria-hidden="true">
          <Skeleton width="40%" height={16} />
          <Skeleton width="80%" height={13} />
          <Skeleton width="55%" height={12} />
        </div>
      ))}
    </section>
  );
}
