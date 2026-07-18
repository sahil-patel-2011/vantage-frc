"use client";

import { useCallback, useEffect, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { PageHeader, Panel } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { withOrgHref } from "../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot, useOnline } from "../../lib/offline";
import {
  TRAVEL_LEG_KINDS,
  TRAVEL_LEG_LABELS,
  type LogisticsView,
  type TravelLegKind,
} from "../../lib/logistics";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type Ready = Extract<LogisticsView, { status: "ready" }>;

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function LogisticsClient() {
  const online = useOnline();
  const [view, setView] = useState<LogisticsView | null>(null);
  const [error, setError] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    const cached = await getFeatureSnapshot<LogisticsView>("logistics", orgId);
    if (cached?.data) {
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
    }
    try {
      const response = await fetch(`/api/logistics${qs}`);
      const data = (await response.json()) as LogisticsView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load logistics");
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setError("");
      const cacheOrg = data.status === "ready" ? data.context.orgId : orgId;
      if (cacheOrg) await putFeatureSnapshot("logistics", cacheOrg, data);
      if (data.status === "ready" && data.trips[0] && !selectedTripId) {
        setSelectedTripId(data.trips[0].id);
      }
    } catch (err: unknown) {
      if (!cached) setError(err instanceof Error ? err.message : "Could not load logistics");
    }
  }, [selectedTripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/logistics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Could not save");
          return;
        }
        await load();
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  if (error && !view) {
    return (
      <main className="log-page">
        <PageHeader navPath="/logistics" title="Logistics" description={error} />
      </main>
    );
  }

  if (!view) {
    return (
      <main className="log-page">
        <PageHeader navPath="/logistics" title="Logistics" description="Loading trip times and lodging…" />
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="log-page">
        <PageHeader navPath="/logistics" title="Logistics" description={view.message} />
        <a className="app-button" href="/workspace">
          Select workspace
        </a>
      </main>
    );
  }

  const ready = view as Ready;
  const { context, trips, myLodging, myTrip, nextLeg, lodgingGaps, activeOnDuty } = ready;
  const orgId = context.orgId!;
  const canManage = context.canManage;
  const trip = trips.find((t) => t.id === selectedTripId) ?? trips[0] ?? null;
  const legs = trip?.travelLegs ?? [];

  return (
    <main className="log-page">
      <PageHeader
        navPath="/logistics"
        title="Logistics"
        description={
          canManage
            ? `${context.orgName ?? "Team"} — plan leave / hotel / venue / return. Calendar shows when to go.`
            : `${context.orgName ?? "Team"} — your trip times and lodging.`
        }
      >
        <div className="log-header-actions">
          <a className="app-button secondary" href={withOrgHref("/team/calendar?tab=trip", orgId)}>
            My trip calendar
          </a>
          <a className="app-button secondary" href={withOrgHref("/packing", orgId)}>
            Packing
          </a>
          <a className="app-button secondary" href={withOrgHref("/duties", orgId)}>
            Duties
          </a>
        </div>
      </PageHeader>
      <TeamOpsNav orgId={orgId} />
      <OfflineBanner
        feature="Logistics"
        fromCache={fromCache}
        cachedAt={cachedAt}
        detail={!online ? "Showing cached trip times." : undefined}
      />
      {error ? <p className="log-banner error">{error}</p> : null}

      {nextLeg ? (
        <Panel>
          <span className="log-kicker">Next on my trip</span>
          <h2>
            {nextLeg.label}: {fmtWhen(nextLeg.startsAt)}
          </h2>
          <p className="app-muted">
            {nextLeg.title}
            {nextLeg.meetingPoint ? ` · Meet ${nextLeg.meetingPoint}` : ""}
          </p>
        </Panel>
      ) : null}

      {!canManage && (myTrip?.length ?? 0) > 0 ? (
        <Panel>
          <span className="log-kicker">My trip</span>
          <h2>When to leave & arrive</h2>
          <ol className="logistics-timeline">
            {(myTrip ?? []).map((stop) => (
              <li key={stop.id} className={nextLeg?.id === stop.id ? "next" : undefined}>
                <span className="logistics-timeline-kind">{stop.label}</span>
                <strong>{fmtWhen(stop.startsAt)}</strong>
                <span>
                  {stop.title}
                  {stop.meetingPoint ? ` · ${stop.meetingPoint}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {!canManage && myLodging ? (
        <Panel>
          <span className="log-kicker">My lodging</span>
          <h2>
            {myLodging.hotelName} · Room {myLodging.roomLabel}
          </h2>
          <p className="app-muted">{myLodging.tripTitle}</p>
        </Panel>
      ) : null}

      {activeOnDuty ? (
        <Panel>
          <span className="log-kicker">Who to find</span>
          <h2>{activeOnDuty.mentorName || "Mentor on duty"}</h2>
          <p>
            {fmtWhen(activeOnDuty.startsAt)}
            {activeOnDuty.locationNote ? ` · ${activeOnDuty.locationNote}` : ""}
          </p>
        </Panel>
      ) : null}

      {canManage && lodgingGaps > 0 ? (
        <p className="log-banner warn" role="status">
          {lodgingGaps} room slot{lodgingGaps === 1 ? "" : "s"} still need an occupant.
        </p>
      ) : null}

      <Panel>
        <h2>Trips & travel times</h2>
        <p className="app-muted">
          Timed leave / hotel / venue / return sync to Team Calendar. Empty until mentors add real times.
        </p>
        {trips.length ? (
          <div className="log-trip-tabs" role="tablist">
            {trips.map((t) => (
              <button
                key={t.id}
                type="button"
                className={trip?.id === t.id ? "active" : undefined}
                onClick={() => setSelectedTripId(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>
        ) : (
          <p className="app-muted">No trips yet.</p>
        )}

        {canManage ? (
          <form
            className="log-grid-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              void run(
                {
                  action: "upsert_trip",
                  orgId,
                  title: String(fd.get("title") ?? ""),
                  eventKey: String(fd.get("eventKey") ?? "") || null,
                  venueName: String(fd.get("venueName") ?? ""),
                  venueAddress: String(fd.get("venueAddress") ?? ""),
                  travelNotes: String(fd.get("travelNotes") ?? ""),
                  transportNotes: String(fd.get("transportNotes") ?? ""),
                  startsOn: String(fd.get("startsOn") ?? "") || null,
                  endsOn: String(fd.get("endsOn") ?? "") || null,
                },
                "trip",
              ).then(() => form.reset());
            }}
          >
            <input name="title" placeholder="Trip title" required />
            <input name="eventKey" placeholder="TBA event key" />
            <input name="venueName" placeholder="Venue" />
            <input name="startsOn" type="date" />
            <input name="endsOn" type="date" />
            <textarea name="travelNotes" placeholder="Travel notes" rows={2} />
            <button type="submit" disabled={busyKey != null}>
              Add trip
            </button>
          </form>
        ) : null}

        {trip ? (
          <div>
            <h3>Get there & back</h3>
            {legs.length === 0 ? (
              <p className="app-muted">No timed legs yet.</p>
            ) : (
              <ol className="logistics-timeline">
                {legs.map((leg) => (
                  <li key={leg.id}>
                    <span className="logistics-timeline-kind">{TRAVEL_LEG_LABELS[leg.kind]}</span>
                    <strong>{fmtWhen(leg.startsAt)}</strong>
                    <span>
                      {leg.title}
                      {leg.meetingPoint ? ` · ${leg.meetingPoint}` : ""}
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        className="log-link danger"
                        disabled={busyKey != null}
                        onClick={() => {
                          if (confirm(`Remove “${leg.title}”?`)) {
                            void run({ action: "delete_travel_leg", orgId, id: leg.id }, `del-leg:${leg.id}`);
                          }
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
            {canManage ? (
              <form
                className="log-grid-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const fd = new FormData(form);
                  const starts = String(fd.get("startsAt") ?? "");
                  void run(
                    {
                      action: "upsert_travel_leg",
                      orgId,
                      tripId: trip.id,
                      kind: String(fd.get("kind") ?? "depart_home") as TravelLegKind,
                      title: String(fd.get("title") ?? ""),
                      startsAt: starts ? new Date(starts).toISOString() : "",
                      endsAt: null,
                      location: String(fd.get("location") ?? ""),
                      meetingPoint: String(fd.get("meetingPoint") ?? ""),
                      notes: String(fd.get("notes") ?? ""),
                      subteamId: null,
                      syncCalendar: true,
                    },
                    "leg",
                  ).then(() => form.reset());
                }}
              >
                <select name="kind" defaultValue="depart_home">
                  {TRAVEL_LEG_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {TRAVEL_LEG_LABELS[k]}
                    </option>
                  ))}
                </select>
                <input name="title" placeholder="Title (optional)" />
                <input name="startsAt" type="datetime-local" required />
                <input name="meetingPoint" placeholder="Meeting point" />
                <input name="location" placeholder="Location" />
                <button type="submit" disabled={busyKey != null}>
                  Add travel time
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </main>
  );
}
