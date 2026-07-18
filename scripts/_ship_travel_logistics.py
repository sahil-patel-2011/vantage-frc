from pathlib import Path

ROOT = Path(r"C:/Users/sahil/Cursor Projects/Vantage FRC Robotics AIO APP")
ROOTS = [ROOT]
v = Path(r"C:/Users/sahil/Cursor Projects/Vantage")
try:
    if v.resolve() != ROOT.resolve():
        ROOTS.append(v)
except OSError:
    pass

CLIENT = Path(__file__).with_name("_ship_logistics_client.tsx.txt")
# Inline short client written below as string for reliability
CLIENT_SRC = r'''"use client";

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
'''

CSS_EXTRA = """
.logistics-timeline{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
.logistics-timeline>li{display:grid;gap:2px 10px;padding:10px 12px;border-radius:12px;border:1px solid var(--soft-line);background:color-mix(in srgb,var(--soft-card) 94%,#fff)}
.logistics-timeline>li.next{border-color:color-mix(in srgb,#1f4fd6 35%,var(--soft-line));background:#f4f7fd}
.logistics-timeline-kind{font:700 11px/1.2 var(--font-source-sans),ui-sans-serif;letter-spacing:.05em;text-transform:uppercase;color:#1f4fd6}
.log-header-actions{display:flex;flex-wrap:wrap;gap:8px}
.log-banner{margin:0;padding:10px 14px;border-radius:12px;font:600 13px var(--font-source-sans),ui-sans-serif}
.log-banner.error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
.log-banner.warn{background:#fff7ed;color:#9a3412;border:1px solid #fed7aa}
.log-kicker{display:block;font:700 11px/1.2 var(--font-source-sans),ui-sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--soft-muted);margin-bottom:6px}
.log-page{max-width:960px;margin:0 auto;padding:clamp(18px,3vw,32px) 16px 56px;display:grid;gap:16px}
.log-grid-form{display:grid;gap:8px;margin-top:12px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
.log-grid-form input,.log-grid-form select,.log-grid-form textarea{border:1px solid var(--soft-line);border-radius:10px;padding:8px 10px;font:inherit}
.log-grid-form textarea{grid-column:1/-1}
.log-trip-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.log-trip-tabs button{border:1px solid var(--soft-line);background:#fff;border-radius:999px;padding:6px 12px;cursor:pointer}
.log-trip-tabs button.active{background:#e8eefc;border-color:#c5d4f7;color:#1f4fd6}
.log-link{border:0;background:transparent;color:#1f4fd6;font:600 12px var(--font-source-sans),ui-sans-serif;cursor:pointer}
.log-link.danger{color:#b91c1c}
"""

TRIP_PANEL = r'''
function TripPanel({
  orgId,
  travelLegs,
  mySubteamIds,
}: {
  orgId: string;
  travelLegs: TravelLegOnCalendar[];
  mySubteamIds: string[];
}) {
  const scoped = useMemo(() => {
    return travelLegs.filter((leg) => leg.subteamId == null || mySubteamIds.includes(leg.subteamId));
  }, [travelLegs, mySubteamIds]);
  const byTrip = useMemo(() => {
    const map = new Map<string, { title: string; items: typeof scoped }>();
    for (const leg of scoped) {
      const bucket = map.get(leg.tripId) ?? { title: leg.tripTitle, items: [] };
      bucket.items.push(leg);
      map.set(leg.tripId, bucket);
    }
    return [...map.entries()];
  }, [scoped]);
  return (
    <div className="tc-layout">
      <section className="tc-panel tc-main">
        {scoped.length === 0 ? (
          <div className="app-card tc-empty tc-guide">
            <strong>No trip times yet</strong>
            <p className="app-muted">Mentors add leave / hotel / venue / return in Event Logistics.</p>
            <a className="app-button" href={withOrg("/logistics", orgId)}>
              Open logistics
            </a>
          </div>
        ) : (
          byTrip.map(([tripId, bucket]) => (
            <div key={tripId} className="tc-day">
              <h3>{bucket.title}</h3>
              {bucket.items.map((leg) => (
                <article key={leg.id} className="tc-event tc-travel">
                  <header>
                    <strong>{leg.title}</strong>
                    <span className="tc-chip">{leg.kind.replaceAll("_", " ")}</span>
                  </header>
                  <div className="tc-meta">
                    <span>{fmtWhen(leg.startsAt)}</span>
                    {leg.meetingPoint ? <span>Meet: {leg.meetingPoint}</span> : null}
                    {leg.location ? <span>{leg.location}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

'''

LOAD_LEGS = """
  let travelLegs: TravelLegOnCalendar[] = [];
  try {
    const legs = await client.query<TravelLegOnCalendar>(
      `SELECT l.id, l.trip_id AS "tripId", t.title AS "tripTitle", l.kind, l.title,
              l.starts_at::text AS "startsAt", l.ends_at::text AS "endsAt",
              l.location, l.meeting_point AS "meetingPoint", l.notes,
              l.subteam_id AS "subteamId", st.name AS "subteamName", st.color AS "subteamColor",
              l.calendar_event_id AS "calendarEventId"
       FROM logistics_travel_legs l
       JOIN logistics_trips t ON t.id = l.trip_id
       LEFT JOIN team_subteams st ON st.id = l.subteam_id
       WHERE l.org_id = $1
       ORDER BY l.starts_at, l.sort_order
       LIMIT 200`,
      [orgId],
    );
    travelLegs = legs.rows;
  } catch {
    travelLegs = [];
  }

"""

for root in ROOTS:
    (root / "apps/web/app/logistics/logistics-client.tsx").write_text(CLIENT_SRC, encoding="utf-8")
    css = root / "apps/web/app/logistics/logistics.css"
    cs = css.read_text(encoding="utf-8") if css.exists() else ""
    if "logistics-timeline" not in cs:
        css.write_text(cs + "\n" + CSS_EXTRA, encoding="utf-8")
    tcss = root / "apps/web/app/team/calendar/team-calendar.css"
    if tcss.exists():
        tcs = tcss.read_text(encoding="utf-8")
        if ".tc-travel" not in tcs:
            tcss.write_text(tcs + "\n.tc-travel{border-left:3px solid #1f4fd6;padding-left:10px}\n", encoding="utf-8")

    route = root / "apps/web/app/api/team/calendar/route.ts"
    rt = route.read_text(encoding="utf-8")
    if "TravelLegOnCalendar" not in rt:
        rt = rt.replace(
            "  type SubteamMemberLite,\n} from",
            "  type SubteamMemberLite,\n  type TravelLegOnCalendar,\n} from",
        )
    if "let travelLegs" not in rt:
        rt = rt.replace('  return {\n    status: "ready",', LOAD_LEGS + '  return {\n    status: "ready",')
    if "    travelLegs,\n" not in rt:
        rt = rt.replace("    duties,\n    mySubteamIds:", "    duties,\n    travelLegs,\n    mySubteamIds:")
    route.write_text(rt, encoding="utf-8")

    cal = root / "apps/web/app/team/calendar/team-calendar-client.tsx"
    ct = cal.read_text(encoding="utf-8")
    if "TravelLegOnCalendar" not in ct:
        ct = ct.replace(
            '  type SubteamMemberLite,\n} from "../../../lib/subteam-calendar";',
            '  type SubteamMemberLite,\n  type TravelLegOnCalendar,\n} from "../../../lib/subteam-calendar";',
        )
    ct = ct.replace(
        'type Tab = "calendar" | "subteams" | "duties" | "sync";',
        'type Tab = "calendar" | "subteams" | "duties" | "trip" | "sync";',
    )
    if "function TripPanel" not in ct:
        if "function DutiesPanel" in ct:
            ct = ct.replace("function DutiesPanel", TRIP_PANEL + "function DutiesPanel")
        else:
            ct = ct.replace(
                "export default function TeamCalendarClient",
                TRIP_PANEL + "export default function TeamCalendarClient",
            )
    if 'params.get("tab") === "trip"' not in ct:
        ct = ct.replace(
            'if (dutyId) {\n      setHighlightDutyId(dutyId);\n      setTab("duties");\n    }',
            'if (dutyId) {\n      setHighlightDutyId(dutyId);\n      setTab("duties");\n    }\n    if (params.get("tab") === "trip") setTab("trip");',
        )
    if 'aria-selected={tab === "trip"}' not in ct:
        needle = 'Duties{(view.duties?.length ?? 0) > 0 ? ` (${view.duties!.length})` : ""}\n        </button>'
        insert = needle + '''
        <button
          type="button"
          role="tab"
          aria-selected={tab === "trip"}
          className={tab === "trip" ? "active" : ""}
          onClick={() => setTab("trip")}
        >
          My trip{(view.travelLegs?.length ?? 0) > 0 ? ` (${view.travelLegs!.length})` : ""}
        </button>'''
        if needle in ct:
            ct = ct.replace(needle, insert)
    if "TripPanel orgId" not in ct:
        for old in (
            ') : tab === "subteams"',
            ') : tab === "sync"',
        ):
            if old in ct:
                ct = ct.replace(
                    old,
                    ') : tab === "trip" ? (\n        <TripPanel orgId={orgId} travelLegs={view.travelLegs ?? []} mySubteamIds={view.mySubteamIds} />\n      ' + old,
                    1,
                )
                break
    cal.write_text(ct, encoding="utf-8")
    print("updated", root)

print("done")
