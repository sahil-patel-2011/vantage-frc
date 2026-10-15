"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { useVenueShortcuts } from "../../hooks/use-venue-shortcuts";
import { countdownLabel } from "../dashboard/widgets";
import { matchClock } from "../dashboard/widgets/live-countdown";
import { eventDayNextActions } from "../../lib/command/event-day-actions";
import { formatEventDayMatchCount } from "../../lib/command/event-day-related";
import { scoutEventLabel } from "../../lib/scouting/scouting-related";
import type { CommandSnapshot } from "../../lib/command/types";
import { FEATURE_API_TIMEOUT_MS, fetchActiveOrgId, readOrgIdFromSearch } from "../../lib/nav/resolve-org";
import { requestMe } from "../../lib/nav/me-request";
import { visibilityPollDelay } from "../../lib/perf/visibility-poll";
import { OfflineBanner } from "../../components/offline-banner";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import {
  EventDayShell,
  classifyEventDayShell,
} from "./command-chrome";
import { CommandEventPicker } from "./command-event-picker";
import {
  COMMAND_POLL_MS,
  commandHrefsFromSnap,
  type Me,
} from "./command-model";
import { CommandReadyView } from "./command-ready-view";
import "./command.css";

export default function CommandClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [me, setMe] = useState<Me>({});
  const [orgId, setOrgId] = useState("");
  // False until the team lookup answers. An empty orgId before then means "not known yet",
  // never "no team" — painting setup in that gap is what showed "No event linked".
  const [orgResolved, setOrgResolved] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [snap, setSnap] = useState<CommandSnapshot | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const loadGeneration = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  // Home's setup action opens the picker, then keeps the team on Event day.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("pickEvent") !== "1") return;
    setEventOpen(true);
  }, []);
  const [tick, setTick] = useState(0);
  const { cheatOpen, setCheatOpen, shortcuts } = useVenueShortcuts(orgId);

  useEffect(() => {
    const fromUrl = readOrgIdFromSearch(window.location.search) ?? "";
    if (fromUrl) setOrgId(fromUrl);
    void fetchActiveOrgId()
      .then((fromMe) => {
        setOrgId((current) => current || fromMe || fromUrl || "");
      })
      .catch(() => {
        setOrgId((current) => current || fromUrl);
      })
      .finally(() => setOrgResolved(true));
    void requestMe()
      .then(({ ok, data }) => {
        if (ok && data) setMe(data as Me);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async (id: string) => {
    const generation = ++loadGeneration.current;
    loadAbort.current?.abort();
    const controller = new AbortController(); loadAbort.current = controller;
    const current = () => generation === loadGeneration.current && !controller.signal.aborted;
    if (!id) { setLoading(false); setSnap(null); setFetchFailed(false); setFromCache(false); return; }
    try {
      const response = await fetch(`/api/command?orgId=${encodeURIComponent(id)}`, {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]),
      });
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        setSnap(null); setFromCache(false); setFetchFailed(true); setLoading(false);
        setError("Your session or team access changed. Sign in again.");
        void clearFeatureSnapshot("competition", id).catch(() => undefined);
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not load Event day.");
      }
      const data = await response.json() as CommandSnapshot;
      if (!current()) return;
      setSnap(data); setError(""); setFetchFailed(false); setFromCache(false);
      setCachedAt(new Date().toISOString()); setLoading(false);
      void putFeatureSnapshot("competition", id, data).catch(() => undefined);
    } catch (error) {
      if (!current()) return;
      const cached = await getFeatureSnapshot<CommandSnapshot>("competition", id).catch(() => null);
      if (!current()) return;
      // A cached "no event" setup answer predates activation; it cannot tell us
      // the current event. Only useful event data may be shown as an offline copy.
      if (cached?.data.orgId === id && cached.data.eventKey && cached.data.status !== "setup_required") {
        setSnap(cached.data); setCachedAt(cached.cachedAt); setFromCache(true);
        setError(""); setFetchFailed(false);
      } else {
        setSnap(null); setFromCache(false); setFetchFailed(true);
        setError(error instanceof Error ? error.message : "Couldn't refresh Event day. Try again.");
      }
      setLoading(false);
    }
  }, []);

  const recomputePrediction = useCallback(async () => {
    if (!orgId) return;
    setRecomputing(true);
    try {
      const response = await fetch("/api/strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "recompute", orgId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not recompute this prediction.");
        return;
      }
      await load(orgId);
    } catch {
      setError("Could not recompute this prediction.");
    } finally {
      setRecomputing(false);
    }
  }, [orgId, load]);

  useEffect(() => {
    if (orgResolved && !orgId) setLoading(false);
  }, [orgResolved, orgId]);

  useEffect(() => {
    if (!orgId) return;
    void load(orgId);
    let timer: number | null = null;
    let cancelled = false;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (document.visibilityState !== "hidden") void load(orgId);
        if (!cancelled) schedule();
      }, visibilityPollDelay(COMMAND_POLL_MS, document.visibilityState === "hidden"));
    };
    schedule();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load(orgId);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      loadGeneration.current++; loadAbort.current?.abort();
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [orgId, load]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const hrefs = commandHrefsFromSnap(snap, orgId || null);
  const next = snap?.matches[0] ?? null;
  const after = snap?.matches[1] ?? null;
  const countdown = useMemo(() => (next?.scheduledTime ? matchClock(next.scheduledTime).value : countdownLabel(null)), [next?.scheduledTime, tick]);
  const liveActions = useMemo(() => eventDayNextActions(snap, { orgId: orgId || null }), [snap, orgId]);

  const eventPicker = (
    <CommandEventPicker open={eventOpen} orgId={orgId} onClose={() => setEventOpen(false)}
      onChanged={() => void load(orgId)} onActive={() => {
        setEventOpen(false);
      }} />
  );

  if (loading && !snap) {
    return <EventDayShell embedded={embedded} orgId={orgId || null} shell={classifyEventDayShell({ loading: true })} />;
  }

  if (!orgId && !loading) {
    return (
      <>
        <EventDayShell embedded={embedded} orgId={null} shell="setup" hasActiveEvent={false} />
        {eventPicker}
      </>
    );
  }

  if ((fetchFailed || error) && !snap) {
    return (
      <>
        <EventDayShell
          embedded={embedded}
          orgId={orgId || null}
          shell="error"
          error={error || undefined}
          onRetry={() => {
            setLoading(true);
            setFetchFailed(false);
            void load(orgId);
          }}
        />
        {eventPicker}
      </>
    );
  }

  const shell = classifyEventDayShell({
    orgId: orgId || null,
    status: snap?.status ?? null,
    eventKey: snap?.eventKey ?? null,
    matchCount: snap?.matches.length ?? 0,
  });

  if (shell === "setup") {
    return (
      <>
        <EventDayShell
          embedded={embedded}
          orgId={orgId || null}
          shell="setup"
          hasActiveEvent={Boolean(snap?.eventKey)}
          error={snap?.status === "setup_required" ? snap.message : undefined}
          canSetEvent={snap?.canSetEvent}
          onSelectEvent={() => setEventOpen(true)}
        />
        {eventPicker}
      </>
    );
  }

  if (shell === "empty") {
    return (
      <>
        <EventDayShell
          embedded={embedded}
          orgId={orgId || null}
          shell="empty"
          hasActiveEvent={Boolean(snap?.eventKey)}
          // The same reason Home gives ("Team 9804 isn't on this event's match schedule…"), and
          // the one fix that helps when it is the wrong event: pick another.
          error={snap?.message}
          canSetEvent={snap?.canSetEvent}
          onSelectEvent={() => setEventOpen(true)}
        >
          <OfflineBanner feature="Event day" fromCache={fromCache} cachedAt={cachedAt} />
          <p className="edc-freshness" role="status">
            {scoutEventLabel({ eventName: snap?.eventName, eventKey: snap?.eventKey }) ?? "Active event"}
            {" · "}
            {formatEventDayMatchCount(snap?.matches.length ?? 0, Boolean(snap))} upcoming matches
          </p>
          <DataSourceDegradedBanner health={snap?.dataSourceHealth} canOpenTeamData={snap?.canSetEvent === true} />
        </EventDayShell>
        {eventPicker}
      </>
    );
  }

  if (!snap) {
    // No answer yet and no failure: still loading, not "No event linked".
    return <EventDayShell embedded={embedded} orgId={orgId || null} shell={classifyEventDayShell({ loading: true })} />;
  }

  return (
    <CommandReadyView
      embedded={embedded}
      orgId={orgId}
      me={me}
      snap={snap}
      hrefs={hrefs}
      liveActions={liveActions}
      next={next}
      after={after}
      countdown={countdown}
      loading={loading}
      fromCache={fromCache}
      cachedAt={cachedAt}
      error={error}
      eventMessage=""
      recomputing={recomputing}
      cheatOpen={cheatOpen}
      shortcuts={shortcuts}
      eventPicker={eventPicker}
      onSelectEvent={() => setEventOpen(true)}
      onRefresh={() => void load(orgId)}
      onRecompute={() => void recomputePrediction()}
      onCloseCheatsheet={() => setCheatOpen(false)}
    />
  );
}
