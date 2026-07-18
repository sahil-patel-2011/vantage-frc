"use client";

import { useCallback, useEffect, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { getFeatureSnapshot, putFeatureSnapshot, useOnline } from "../../lib/offline";

type LogisticsSnapshot = {
  status: string;
  message?: string;
  context?: { orgId?: string | null; orgName?: string | null };
  trips?: Array<{ id: string; title: string; venueName?: string; startsOn?: string | null }>;
  lodgingGaps?: number;
  myLodging?: { hotelName: string; roomLabel: string } | null;
  nextLeg?: { title: string; startsAt: string; label?: string } | null;
};

export default function LogisticsClient() {
  const online = useOnline();
  const [view, setView] = useState<LogisticsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    const cached = await getFeatureSnapshot<LogisticsSnapshot>("logistics", orgId);
    if (cached?.data) {
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
    }
    try {
      const response = await fetch(`/api/logistics${qs}`);
      if (response.status === 404) {
        setSetupRequired(true);
        if (!cached) setView(null);
        return;
      }
      const data = (await response.json()) as LogisticsSnapshot & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not load logistics");
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setSetupRequired(data.status === "setup_required");
      const cacheOrg = data.context?.orgId || orgId;
      if (cacheOrg) await putFeatureSnapshot("logistics", cacheOrg, data);
    } catch (err: unknown) {
      if (!cached) {
        setError(err instanceof Error ? err.message : "Could not load logistics");
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const orgId = view?.context?.orgId ?? null;

  if (error && !view) {
    return (
      <main className="module-page">
        <PageHeader navPath="/logistics" title="Logistics" description={error} />
        <TeamOpsNav active="calendar" />
        <OfflineBanner
          feature="Logistics"
          fromCache={false}
          detail={
            !online
              ? "No cached logistics on this device yet. Open this page once while online at the event."
              : undefined
          }
        />
        <EmptyState soft title="Could not load logistics" description={error}>
          <button type="button" className="app-button secondary" onClick={() => void load()}>
            Retry
          </button>
        </EmptyState>
      </main>
    );
  }

  if (!view && !setupRequired) {
    return (
      <main className="module-page">
        <PageHeader navPath="/logistics" title="Logistics" description="Loading lodging and travel…" />
        <TeamOpsNav active="calendar" />
      </main>
    );
  }

  if (setupRequired && (!view || view.status === "setup_required")) {
    return (
      <main className="module-page">
        <PageHeader
          navPath="/logistics"
          title="Logistics"
          description={view?.message ?? "Event lodging and travel will appear here once configured for your team."}
        />
        <TeamOpsNav orgId={orgId} active="calendar" />
        <OfflineBanner feature="Logistics" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title="Logistics not ready yet"
          description="Mentors add hotels, travel legs, and day-of checklists when the event is booked. Open this page once online so it stays available offline."
        >
          <a className="app-button" href={orgId ? `/workspace?orgId=${encodeURIComponent(orgId)}` : "/workspace"}>
            Workspace
          </a>
          <a className="app-button secondary" href={orgId ? `/team/calendar?orgId=${encodeURIComponent(orgId)}` : "/team/calendar"}>
            Team calendar
          </a>
        </EmptyState>
      </main>
    );
  }

  const trips = view?.trips ?? [];
  const lodgingGaps = view?.lodgingGaps ?? 0;

  return (
    <main className="module-page">
      <PageHeader
        navPath="/logistics"
        title="Logistics"
        description="Hotel, travel times, and day-of checklists — last-good copy stays on this device when venue Wi-Fi drops."
      >
        <a
          className="app-button secondary"
          href={orgId ? `/team/calendar?orgId=${encodeURIComponent(orgId)}` : "/team/calendar"}
        >
          Team calendar
        </a>
      </PageHeader>
      <TeamOpsNav orgId={orgId} active="calendar" />
      <OfflineBanner feature="Logistics" fromCache={fromCache} cachedAt={cachedAt} />

      {lodgingGaps > 0 ? (
        <p className="offline-banner" role="status">
          <strong>Lodging</strong>
          <span>
            {lodgingGaps} room{lodgingGaps === 1 ? "" : "s"} still need an occupant.
          </span>
        </p>
      ) : null}

      {view?.myLodging ? (
        <Panel>
          <h2>My hotel</h2>
          <p>
            <strong>{view.myLodging.hotelName}</strong> · Room {view.myLodging.roomLabel}
          </p>
        </Panel>
      ) : null}

      {view?.nextLeg ? (
        <Panel>
          <h2>Next travel stop</h2>
          <p>
            {view.nextLeg.label ? `${view.nextLeg.label}: ` : ""}
            {view.nextLeg.title}
          </p>
          <p className="app-muted">{new Date(view.nextLeg.startsAt).toLocaleString()}</p>
        </Panel>
      ) : null}

      <Panel>
        <h2>Trips</h2>
        {trips.length === 0 ? (
          <p className="app-muted">No trips cached yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {trips.map((trip) => (
              <li key={trip.id}>
                <strong>{trip.title}</strong>
                {(trip.venueName || trip.startsOn) && (
                  <span className="app-muted">
                    {" "}
                    — {[trip.venueName, trip.startsOn].filter(Boolean).join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
