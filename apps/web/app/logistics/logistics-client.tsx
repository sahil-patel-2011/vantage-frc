"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { withOrgHref } from "../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot, useOnline } from "../../lib/offline";
import {
  AUDIENCE_LABEL,
  CHECKLIST_AUDIENCES,
  TRAVEL_LEG_KINDS,
  TRAVEL_LEG_LABELS,
  checklistProgress,
  filterChecklistForViewer,
  type ChecklistAudience,
  type ChecklistItem,
  type EmergencyContact,
  type Hotel,
  type LogisticsMember,
  type LogisticsTrip,
  type LogisticsView,
  type OnDutySlot,
  type TravelLegKind,
} from "../../lib/logistics";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type Ready = Extract<LogisticsView, { status: "ready" }>;

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function memberLabel(m: LogisticsMember): string {
  return m.name?.trim() || m.email?.trim() || m.userId.slice(0, 8);
}

function canActOnline(online: boolean, fromCache: boolean): boolean {
  return online && !fromCache;
}

export default function LogisticsClient() {
  const online = useOnline();
  const [view, setView] = useState<LogisticsView | null>(null);
  const [error, setError] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
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
      const cacheOrg = data.status === "ready" ? data.context.orgId : orgId;
      if (cacheOrg) await putFeatureSnapshot("logistics", cacheOrg, data);
      if (data.status === "ready" && data.trips[0]) {
        setSelectedTripId((prev) => prev ?? data.trips[0]?.id ?? null);
      }
    } catch (err: unknown) {
      if (!cached) setError(err instanceof Error ? err.message : "Could not load logistics");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      if (!canActOnline(online, fromCache)) {
        setError("Reconnect to save changes (cached copy is read-only).");
        return;
      }
      setBusyKey(key);
      setError("");
      setOkMessage("");
      try {
        const response = await fetch("/api/logistics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as LogisticsView & { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Could not save");
          return;
        }
        if ("status" in data) {
          setView(data);
          setFromCache(false);
          setCachedAt(null);
          if (data.status === "ready") {
            await putFeatureSnapshot("logistics", data.context.orgId, data);
            if (data.trips[0]) setSelectedTripId((prev) => prev ?? data.trips[0]?.id ?? null);
          }
        } else {
          await load();
        }
        setOkMessage("Saved.");
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [fromCache, load, online],
  );


  const orgIdParam = view?.status === "ready" ? view.context.orgId : view?.context?.orgId ?? null;

  if (error && !view) {
    return (
      <main className="log-page">
        <PageHeader navPath="/logistics" title="Logistics" description={error} />
        <TeamOpsNav active="logistics" />
        <OfflineBanner feature="Logistics" fromCache={false} detail={!online ? "Open once online to cache trip info." : undefined} />
        <EmptyState soft title="Could not load logistics" description={error}>
          <button type="button" className="app-button secondary" onClick={() => void load()}>
            Retry
          </button>
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="log-page">
        <PageHeader navPath="/logistics" title="Logistics" description="Loading trip times and lodging…" />
        <TeamOpsNav active="logistics" />
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="log-page">
        <PageHeader navPath="/logistics" title="Logistics" description={view.message} />
        <TeamOpsNav orgId={orgIdParam} active="logistics" />
        <OfflineBanner feature="Logistics" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState soft title="Logistics not ready yet" description="Apply the event logistics migration or pick a workspace with logistics enabled.">
          <a className="app-button" href={orgIdParam ? withOrgHref("/workspace", orgIdParam) : "/workspace"}>
            Workspace
          </a>
        </EmptyState>
      </main>
    );
  }

  const ready = view;
  const {
    context,
    trips,
    sharedChecklist,
    contacts,
    members,
    myLodging,
    myTrip,
    nextLeg,
    lodgingGaps,
    activeOnDuty,
  } = ready;
  const orgId = context.orgId;
  const canManage = context.canManage;
  const trip = trips.find((t) => t.id === selectedTripId) ?? trips[0] ?? null;
  const legs = trip?.travelLegs ?? [];
  const viewerChecklist = useMemo(
    () => filterChecklistForViewer(sharedChecklist, context.teamRole),
    [sharedChecklist, context.teamRole],
  );
  const checklistStats = checklistProgress(viewerChecklist);
  const busy = busyKey != null;
  const act = canActOnline(online, fromCache);

  const toggleChecklist = (item: ChecklistItem, checked: boolean) => {
    void run({ action: "toggle_checklist", orgId, id: item.id, checked }, `chk:${item.id}`);
  };

  return (
    <main className="log-page">
      <PageHeader
        navPath="/logistics"
        title="Logistics"
        description={
          canManage
            ? `${context.orgName ?? "Team"} — plan hotels, travel legs, contacts, and day-of checklists.`
            : `${context.orgName ?? "Team"} — your lodging, who to call, and day-of checklist.`
        }
      >
        <div className="log-header-actions">
          <a className="app-button secondary" href={withOrgHref("/team/calendar?tab=trip", orgId)}>
            Team calendar
          </a>
          <a className="app-button secondary" href={withOrgHref("/visit-invites", orgId)}>
            Visit invites
          </a>
        </div>
      </PageHeader>
      <TeamOpsNav orgId={orgId} active="logistics" />
      <OfflineBanner
        feature="Logistics"
        fromCache={fromCache}
        cachedAt={cachedAt}
        detail={!online ? "Showing cached logistics from this device." : undefined}
      />
      {error ? <p className="log-banner error">{error}</p> : null}
      {okMessage ? <p className="log-banner ok">{okMessage}</p> : null}

      {nextLeg ? (
        <Panel className="logistics-mine">
          <span className="log-kicker">Next on my trip</span>
          <h2>
            {nextLeg.label}: {fmtWhen(nextLeg.startsAt)}
          </h2>
          <p className="app-muted">
            {nextLeg.title}
            {nextLeg.meetingPoint ? ` · Meet at ${nextLeg.meetingPoint}` : ""}
            {nextLeg.location ? ` · ${nextLeg.location}` : ""}
          </p>
        </Panel>
      ) : !canManage ? (
        <Panel>
          <span className="log-kicker">Next on my trip</span>
          <p className="app-muted">No upcoming travel times published yet.</p>
        </Panel>
      ) : null}

      {!canManage && (myTrip?.length ?? 0) > 0 ? (
        <Panel>
          <span className="log-kicker">My trip</span>
          <h2>When to leave and arrive</h2>
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

      {myLodging ? (
        <Panel className="logistics-mine">
          <span className="log-kicker">My lodging</span>
          <h2>
            {myLodging.hotelName} · Room {myLodging.roomLabel}
          </h2>
          <p className="app-muted">{myLodging.tripTitle}</p>
          {myLodging.hotelAddress ? <p>{myLodging.hotelAddress}</p> : null}
          {myLodging.hotelPhone ? (
            <p>
              <a href={`tel:${myLodging.hotelPhone.replace(/\s/g, "")}`}>{myLodging.hotelPhone}</a>
            </p>
          ) : null}
          {(myLodging.checkInAt || myLodging.checkOutAt) && (
            <p className="app-muted">
              Check-in {fmtWhen(myLodging.checkInAt)} · Check-out {fmtWhen(myLodging.checkOutAt)}
            </p>
          )}
        </Panel>
      ) : !canManage ? (
        <Panel>
          <span className="log-kicker">My lodging</span>
          <p className="app-muted">No room assignment yet. Mentors add hotels and rooming lists when travel is booked.</p>
        </Panel>
      ) : null}

      {activeOnDuty ? (
        <Panel>
          <span className="log-kicker">Mentor on duty</span>
          <h2>{activeOnDuty.mentorName || "On-duty mentor"}</h2>
          <p>
            {fmtWhen(activeOnDuty.startsAt)}
            {activeOnDuty.endsAt ? ` – ${fmtWhen(activeOnDuty.endsAt)}` : ""}
            {activeOnDuty.locationNote ? ` · ${activeOnDuty.locationNote}` : ""}
          </p>
          {activeOnDuty.phone ? (
            <p>
              <a href={`tel:${activeOnDuty.phone.replace(/\s/g, "")}`}>{activeOnDuty.phone}</a>
            </p>
          ) : null}
          {activeOnDuty.notes ? <p className="app-muted">{activeOnDuty.notes}</p> : null}
        </Panel>
      ) : !canManage ? (
        <Panel>
          <span className="log-kicker">Mentor on duty</span>
          <p className="app-muted">No on-duty schedule posted yet.</p>
        </Panel>
      ) : null}

      <Panel className="log-checklist">
        <div className="log-section-head">
          <div>
            <h2>Day-of checklist</h2>
            <p className="app-muted">Check items off as you go. Mentors see mentor items; students see student items.</p>
          </div>
          {checklistStats.total > 0 ? (
            <div className="log-progress" aria-label={`${checklistStats.percent}% complete`}>
              <div className="log-progress-bar" style={{ width: `${checklistStats.percent}%` }} />
              <span>
                {checklistStats.done}/{checklistStats.total}
              </span>
            </div>
          ) : null}
        </div>
        {viewerChecklist.length === 0 ? (
          <p className="app-muted">Nothing on your checklist yet.</p>
        ) : (
          <ul className="log-checklist-list">
            {viewerChecklist.map((item) => (
              <li key={item.id}>
                <label className={item.checked ? "log-check-done" : undefined}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    disabled={!act || busy}
                    onChange={(event) => toggleChecklist(item, event.target.checked)}
                  />
                  <span>{item.label}</span>
                  <small className="app-muted">{AUDIENCE_LABEL[item.audience]}</small>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <h2>Emergency contacts</h2>
        <p className="app-muted">Call these mentors first if something goes wrong on the trip.</p>
        {contacts.length === 0 ? (
          <p className="app-muted">No contacts posted yet.</p>
        ) : (
          <ul className="logistics-list">
            {[...contacts]
              .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
              .map((contact) => (
                <li key={contact.id} className={contact.isPrimary ? "log-contact-primary" : undefined}>
                  <strong>{contact.name}</strong>
                  {contact.roleLabel ? <span>{contact.roleLabel}</span> : null}
                  {contact.phone ? <a href={`tel:${contact.phone.replace(/\s/g, "")}`}>{contact.phone}</a> : null}
                  {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
                  {contact.notes ? <p className="app-muted">{contact.notes}</p> : null}
                </li>
              ))}
          </ul>
        )}
      </Panel>


      {canManage && lodgingGaps > 0 ? (
        <p className="log-banner warn" role="status">
          {lodgingGaps} room slot{lodgingGaps === 1 ? "" : "s"} still need an occupant.
        </p>
      ) : null}

      {canManage ? (
        <Panel>
          <h2>Checklist planning</h2>
          <p className="app-muted">Seed default student and mentor lists, then customize items per trip.</p>
          <div className="log-inline-actions">
            <button
              type="button"
              className="app-button secondary"
              disabled={!act || busy}
              onClick={() => void run({ action: "seed_checklist", orgId, tripId: trip?.id ?? null }, "seed-chk")}
            >
              Seed default checklist
            </button>
          </div>
          <form
            className="log-grid-form"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void run(
                {
                  action: "add_checklist_item",
                  orgId,
                  tripId: String(fd.get("tripId") || "") || null,
                  audience: String(fd.get("audience") ?? "student") as ChecklistAudience,
                  label: String(fd.get("label") ?? ""),
                },
                "add-chk",
              ).then(() => e.currentTarget.reset());
            }}
          >
            <select name="tripId" defaultValue={trip?.id ?? ""}>
              <option value="">All trips (shared)</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <select name="audience" defaultValue="student">
              {CHECKLIST_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {AUDIENCE_LABEL[a]}
                </option>
              ))}
            </select>
            <input name="label" placeholder="New checklist item" required />
            <button type="submit" disabled={!act || busy}>
              Add item
            </button>
          </form>
          {sharedChecklist.length === 0 ? (
            <p className="app-muted">No checklist items yet.</p>
          ) : (
            <ul className="log-checklist-list log-checklist-manage">
              {sharedChecklist.map((item) => (
                <li key={item.id}>
                  <span>{item.label}</span>
                  <small className="app-muted">{AUDIENCE_LABEL[item.audience]}</small>
                  <button
                    type="button"
                    className="log-link danger"
                    disabled={!act || busy}
                    onClick={() => {
                      if (confirm(`Remove "${item.label}"?`)) {
                        void run({ action: "delete_checklist_item", orgId, id: item.id }, `del-chk:${item.id}`);
                      }
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {canManage ? (
        <Panel>
          <h2>Emergency contacts (edit)</h2>
          <form
            className="log-grid-form"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void run(
                {
                  action: "upsert_contact",
                  orgId,
                  name: String(fd.get("name") ?? ""),
                  roleLabel: String(fd.get("roleLabel") ?? ""),
                  phone: String(fd.get("phone") ?? ""),
                  email: String(fd.get("email") ?? ""),
                  notes: String(fd.get("notes") ?? ""),
                  isPrimary: fd.get("isPrimary") === "on",
                  sortOrder: Number(fd.get("sortOrder") ?? 0),
                },
                "contact",
              ).then(() => e.currentTarget.reset());
            }}
          >
            <input name="name" placeholder="Name" required />
            <input name="roleLabel" placeholder="Role label" />
            <input name="phone" placeholder="Phone" />
            <input name="email" placeholder="Email" />
            <input name="sortOrder" type="number" placeholder="Sort order" defaultValue={0} />
            <label className="log-check-inline">
              <input name="isPrimary" type="checkbox" /> Primary contact
            </label>
            <textarea name="notes" placeholder="Notes" rows={2} />
            <button type="submit" disabled={!act || busy}>
              Save contact
            </button>
          </form>
          {contacts.map((contact) => (
            <div key={contact.id} className="log-manage-row">
              <span>
                <strong>{contact.name}</strong> {contact.phone}
              </span>
              <button
                type="button"
                className="log-link danger"
                disabled={!act || busy}
                onClick={() => void run({ action: "delete_contact", orgId, id: contact.id }, `del-contact:${contact.id}`)}
              >
                Delete
              </button>
            </div>
          ))}
        </Panel>
      ) : null}

      {canManage ? (
        <Panel>
          <h2>On-duty mentors</h2>
          <form
            className="log-grid-form"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const starts = String(fd.get("startsAt") ?? "");
              const ends = String(fd.get("endsAt") ?? "");
              void run(
                {
                  action: "upsert_on_duty",
                  orgId,
                  tripId: String(fd.get("tripId") || "") || null,
                  mentorUserId: String(fd.get("mentorUserId") || "") || null,
                  mentorName: String(fd.get("mentorName") ?? ""),
                  phone: String(fd.get("phone") ?? ""),
                  startsAt: starts ? new Date(starts).toISOString() : "",
                  endsAt: ends ? new Date(ends).toISOString() : null,
                  locationNote: String(fd.get("locationNote") ?? ""),
                  notes: String(fd.get("notes") ?? ""),
                },
                "onduty",
              ).then(() => e.currentTarget.reset());
            }}
          >
            <select name="tripId" defaultValue={trip?.id ?? ""}>
              <option value="">Any trip</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <select name="mentorUserId" defaultValue="">
              <option value="">Pick mentor (optional)</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {memberLabel(m)}
                </option>
              ))}
            </select>
            <input name="mentorName" placeholder="Display name override" />
            <input name="phone" placeholder="Phone" />
            <input name="startsAt" type="datetime-local" required />
            <input name="endsAt" type="datetime-local" />
            <input name="locationNote" placeholder="Location (pit, hotel lobby…)" />
            <textarea name="notes" placeholder="Notes" rows={2} />
            <button type="submit" disabled={!act || busy}>
              Save on-duty slot
            </button>
          </form>
          <OnDutyManageList orgId={orgId} slots={ready.activeOnDuty ? [ready.activeOnDuty] : []} />
        </Panel>
      ) : null}

