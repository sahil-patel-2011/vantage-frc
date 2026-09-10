"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { useVenueShortcuts } from "../../hooks/use-venue-shortcuts";
import { countdownLabel } from "../dashboard/widgets";
import { eventDayNextActions } from "../../lib/command/event-day-actions";
import { formatEventDayMatchCount } from "../../lib/command/event-day-related";
import type { CommandSnapshot } from "../../lib/command/types";
import { visibilityPollDelay } from "../../lib/perf/visibility-poll";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import {
  EventDayShell,
  classifyEventDayShell,
} from "./command-chrome";
import { CommandEventPicker } from "./command-event-picker";
import {
  COMMAND_POLL_MS,
  commandHrefsFromSnap,
  type EventOption,
  type Me,
} from "./command-model";
import { CommandReadyView } from "./command-ready-view";
import "./command.css";

export default function CommandClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [me, setMe] = useState<Me>({});
  const [orgId, setOrgId] = useState("");
  const [recomputing, setRecomputing] = useState(false);
  const [snap, setSnap] = useState<CommandSnapshot | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventQ, setEventQ] = useState("");
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventMessage, setEventMessage] = useState("");
  const [tick, setTick] = useState(0);
  const { cheatOpen, setCheatOpen, shortcuts } = useVenueShortcuts(orgId);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("orgId") ?? "";
    void fetch("/api/me")
      .then(async (r) => (r.ok ? ((await r.json()) as Me) : null))
      .then((data) => {
        if (!data) return;
        setMe(data);
        setOrgId(fromUrl || data.orgId || "");
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) {
      setLoading(false);
      setSnap(null);
      setFetchFailed(false);
      setFromCache(false);
      return;
    }
    try {
      const response = await fetch(`/api/command?orgId=${encodeURIComponent(id)}`);
      if (!response.ok) {
        const cached = await getFeatureSnapshot<CommandSnapshot>("competition", id);
        if (cached) {
          setSnap(cached.data);
          setCachedAt(cached.cachedAt);
          setFromCache(true);
          setError("");
          setFetchFailed(false);
          setLoading(false);
          return;
        }
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Could not load Event Day Command");
        setFetchFailed(true);
        setLoading(false);
        return;
      }
      const data = (await response.json()) as CommandSnapshot;
      setSnap(data);
      setError("");
      setFetchFailed(false);
      setFromCache(false);
      setCachedAt(new Date().toISOString());
      setLoading(false);
      await putFeatureSnapshot("competition", id, data);
    } catch {
      const cached = await getFeatureSnapshot<CommandSnapshot>("competition", id);
      if (cached) {
        setSnap(cached.data);
        setCachedAt(cached.cachedAt);
        setFromCache(true);
        setError("");
        setFetchFailed(false);
        setLoading(false);
        return;
      }
      setError("Could not load Event Day Command");
      setFetchFailed(true);
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
    if (!orgId) {
      setLoading(false);
      return;
    }
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
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [orgId, load]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const loadEvents = useCallback(
    async (q: string) => {
      if (!orgId) return;
      const year = new Date().getFullYear();
      const params = new URLSearchParams({ orgId, year: String(year), q });
      const response = await fetch(`/api/context/event?${params}`);
      if (!response.ok) return;
      const data = await response.json();
      setEvents(data.events ?? []);
    },
    [orgId],
  );

  useEffect(() => {
    if (!eventOpen) return;
    const handle = window.setTimeout(() => void loadEvents(eventQ), 200);
    return () => window.clearTimeout(handle);
  }, [eventOpen, eventQ, loadEvents]);

  async function setActiveEvent(eventKey: string | null) {
    if (!orgId) return;
    setEventBusy(true);
    setEventMessage("");
    try {
      const response = await fetch("/api/context/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, eventKey }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setEventMessage(body.error ?? "Could not set event");
        return;
      }
      setEventOpen(false);
      setEventMessage(eventKey ? `Active event set to ${body.eventName ?? eventKey}` : "Active event cleared");
      await load(orgId);
    } finally {
      setEventBusy(false);
    }
  }

  const hrefs = commandHrefsFromSnap(snap, orgId || null);
  const next = snap?.matches[0] ?? null;
  const after = snap?.matches[1] ?? null;
  const countdown = useMemo(() => countdownLabel(next?.scheduledTime), [next?.scheduledTime, tick]);
  const liveActions = useMemo(() => eventDayNextActions(snap, { orgId: orgId || null }), [snap, orgId]);

  const eventPicker = (
    <CommandEventPicker
      open={eventOpen}
      query={eventQ}
      events={events}
      busy={eventBusy}
      snap={snap}
      teamDataHref={hrefs.teamData}
      onClose={() => setEventOpen(false)}
      onQuery={setEventQ}
      onSelect={(eventKey) => void setActiveEvent(eventKey)}
      onClear={() => void setActiveEvent(null)}
    />
  );

  if (loading && !snap && orgId) {
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
          onSelectEvent={snap?.canSetEvent ? () => setEventOpen(true) : undefined}
        />
        {eventPicker}
      </>
    );
  }

  if (shell === "empty") {
    return (
      <>
        <EventDayShell embedded={embedded} orgId={orgId || null} shell="empty" hasActiveEvent={Boolean(snap?.eventKey)}>
          <p className="edc-freshness" role="status">
            {snap?.eventName ?? snap?.eventKey ?? "Active event"}
            {" · "}
            {formatEventDayMatchCount(snap?.matches.length ?? 0, Boolean(snap))} upcoming matches
          </p>
          <DataSourceDegradedBanner health={snap?.dataSourceHealth} />
        </EventDayShell>
        {eventPicker}
      </>
    );
  }

  if (!snap) {
    return <EventDayShell embedded={embedded} orgId={orgId || null} shell="setup" hasActiveEvent={false} />;
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
      eventMessage={eventMessage}
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
