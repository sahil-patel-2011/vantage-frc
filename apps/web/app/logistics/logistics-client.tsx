"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { LogisticsRelated } from "../../components/logistics-related";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  TextBlockSkeleton,
  CardGridSkeleton,
} from "../../components/ui";
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
  type Hotel,
  type LogisticsMember,
  type LogisticsView,
  type TravelLegKind,
} from "../../lib/logistics";
import {
  LOGISTICS_RELATED_INCLUDE,
  classifyLogisticsShell,
  formatLodgingClarity,
  logisticsShellCopy,
  logisticsShellNextActions,
  logisticsSetupSteps,
  type LogisticsShellKind,
  type LogisticsShellNextAction,
} from "../../lib/logistics/logistics-related";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

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

function LogisticsNextActionsPanel({ actions }: { actions: LogisticsShellNextAction[] }) {
  if (!actions.length) return null;
  return (
    <Panel className="log-next-actions edc-next-actions soft-panel">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className={action.primary ? "app-button" : "app-button secondary"} href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function LogisticsShell({
  orgId,
  shell,
  canManage,
  error,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: LogisticsShellKind;
  canManage?: boolean;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = logisticsShellNextActions({ orgId, shell, canManage });
  const copy = logisticsShellCopy(shell);
  const steps = shell === "setup" || shell === "empty" ? logisticsSetupSteps(orgId) : [];
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";

  if (shell === "loading") {
    return (
      <main className="log-page soft-gate">
        <PageHeader
          navPath="/logistics"
          title="Logistics"
          description="Hotels, rooming, travel legs, and day-of checklists."
        >
          <LogisticsRelated orgId={orgId} include={[...LOGISTICS_RELATED_INCLUDE]} />
        </PageHeader>
        <TeamOpsNav orgId={orgId ?? undefined} active="logistics" />
        {children}
        <div aria-busy="true" aria-label="Loading logistics">
          <TextBlockSkeleton lines={2} />
          <div style={{ height: 16 }} />
          <CardGridSkeleton cols={2} rows={2} />
        </div>
      </main>
    );
  }

  if (shell === "error") {
    return (
      <main className="log-page soft-gate">
        <PageHeader
          navPath="/logistics"
          title="Logistics"
          description="Hotels, rooming, travel legs, and day-of checklists."
        >
          <LogisticsRelated orgId={orgId} include={[...LOGISTICS_RELATED_INCLUDE]} />
        </PageHeader>
        <TeamOpsNav orgId={orgId ?? undefined} active="logistics" />
        {children}
        <ErrorState title={copy.title} message={error ?? copy.description} onRetry={onRetry} />
        <LogisticsNextActionsPanel actions={actions} />
      </main>
    );
  }

  return (
    <main className="log-page soft-gate">
      <PageHeader
        navPath="/logistics"
        title="Logistics"
        description="Hotels, rooming, travel legs, and day-of checklists."
      >
        <LogisticsRelated orgId={orgId} include={[...LOGISTICS_RELATED_INCLUDE]} />
      </PageHeader>
      <TeamOpsNav orgId={orgId ?? undefined} active="logistics" />
      {children}
      <EmptyState
        soft
        badge={copy.badge}
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
      >
        {shell === "setup" ? (
          <a className="app-button is-primary" href={workspaceHref}>Choose your team</a>
        ) : null}
        {shell === "empty" && canManage ? (
          <a className="app-button" href={withOrgHref("/logistics", orgId) + "#logistics-create-trip"}>
            Add a trip
          </a>
        ) : null}
        {/* The same four cross-links are already in the page header, a few
            hundred pixels up and always visible. Rendering them again inside the
            empty state put Event Day / My Day / Calendar / Visit invites on this
            screen twice and buried the one action that actually moves you
            forward. The empty state keeps its single primary action. */}
        {steps.length > 0 ? (
          <ol className="strategy-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        ) : null}
      </EmptyState>
      <LogisticsNextActionsPanel actions={actions} />
    </main>
  );
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
  const [fetchFailed, setFetchFailed] = useState(false);

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
      setFetchFailed(false);
      const cacheOrg = data.status === "ready" ? data.context.orgId : orgId;
      if (cacheOrg) await putFeatureSnapshot("logistics", cacheOrg, data);
      if (data.status === "ready") {
        setSelectedTripId((prev) => {
          if (prev && data.trips.some((t) => t.id === prev)) return prev;
          return data.trips[0]?.id ?? null;
        });
      }
    } catch (err: unknown) {
      if (!cached) {
        setFetchFailed(true);
        setError(err instanceof Error ? err.message : "Could not load logistics");
      }
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
            setSelectedTripId((prev) => {
              if (prev && data.trips.some((t) => t.id === prev)) return prev;
              return data.trips[0]?.id ?? null;
            });
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
  const urlOrg =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("orgId") : null;

  if (error && !view) {
    return (
      <LogisticsShell
        orgId={urlOrg}
        shell="error"
        error={error}
        onRetry={() => {
          setFetchFailed(false);
          void load();
        }}
      >
        <OfflineBanner
          feature="Logistics"
          fromCache={false}
          detail={!online ? "Open once online to cache trip info." : undefined}
        />
      </LogisticsShell>
    );
  }

  if (!view) {
    return (
      <LogisticsShell
        orgId={urlOrg}
        shell={classifyLogisticsShell({ loading: !fetchFailed, fetchFailed })}
      />
    );
  }

  if (view.status === "setup_required") {
    return (
      <LogisticsShell
        orgId={orgIdParam}
        shell="setup"
        error={view.message}
      >
        <OfflineBanner feature="Logistics" fromCache={fromCache} cachedAt={cachedAt} />
      </LogisticsShell>
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
  const viewerChecklist = filterChecklistForViewer(sharedChecklist, context.teamRole);
  const checklistStats = checklistProgress(viewerChecklist);
  const busy = busyKey != null;
  const act = canActOnline(online, fromCache);
  const hasPlan = trips.length > 0;
  const hotelCount = trips.reduce((n, t) => n + t.hotels.length, 0);
  const travelLegCount = trips.reduce((n, t) => n + t.travelLegs.length, 0);
  const lodgingLine = formatLodgingClarity({
    hotelName: myLodging?.hotelName,
    roomLabel: myLodging?.roomLabel,
  });
  const readyActions = logisticsShellNextActions({
    orgId,
    shell: hasPlan ? "ready" : "empty",
    canManage,
    lodgingGaps,
    hotelCount,
    travelLegCount,
  });

  if (!hasPlan) {
    return (
      <LogisticsShell orgId={orgId} shell="empty" canManage={canManage}>
        <OfflineBanner
          feature="Logistics"
          fromCache={fromCache}
          cachedAt={cachedAt}
          detail={!online ? "Showing cached logistics from this device." : undefined}
        />
      </LogisticsShell>
    );
  }

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
            : `${context.orgName ?? "Team"} — your lodging, leave times, who to call, and day-of checklist.`
        }
      >
        <LogisticsRelated orgId={orgId} include={[...LOGISTICS_RELATED_INCLUDE]} />
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

      <LogisticsNextActionsPanel actions={readyActions} />

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

      {myLodging && lodgingLine ? (
        <Panel className="logistics-mine">
          <span className="log-kicker">My lodging</span>
          <h2>{lodgingLine}</h2>
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
          <p className="app-muted">
            No room assignment yet. Mentors add hotels and rooming lists when travel is booked.
          </p>
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
          <EmptyState
            soft
            title="Nothing on your checklist yet"
            description={canManage ? "Seed defaults or add items below." : "Mentors add checklist items before the trip."}
          />
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
          <EmptyState soft title="No contacts posted yet" description="Mentors add primary phone numbers before travel." />
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
          {activeOnDuty ? (
            <div className="log-manage-row">
              <span>
                {activeOnDuty.mentorName || "On duty"} · {fmtWhen(activeOnDuty.startsAt)}
              </span>
              <button
                type="button"
                className="log-link danger"
                disabled={!act || busy}
                onClick={() => void run({ action: "delete_on_duty", orgId, id: activeOnDuty.id }, `del-od:${activeOnDuty.id}`)}
              >
                Remove active slot
              </button>
            </div>
          ) : (
            <p className="app-muted">No on-duty slot is active right now. Add one above before travel.</p>
          )}
        </Panel>
      ) : null}

      <Panel id="logistics-create-trip" className="log-trip-panel">
        <div className="log-section-head">
          <div>
            <h2>Trips, hotels, and travel times</h2>
            <p className="app-muted">
              Publish leave, hotel, venue, and return times. Legs sync to Team Calendar when configured. Counts reflect
              saved lodging only.
            </p>
          </div>
        </div>

        {trips.length ? (
          <div className="log-trip-tabs" role="tablist" aria-label="Trips">
            {trips.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={trip?.id === t.id}
                className={trip?.id === t.id ? "active" : undefined}
                onClick={() => setSelectedTripId(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>
        ) : null}

        {canManage ? (
          <form
            className="log-grid-form"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void run(
                {
                  action: "create_trip",
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
              ).then(() => e.currentTarget.reset());
            }}
          >
            <input name="title" placeholder="Trip title" required />
            <input name="eventKey" placeholder="TBA event key (optional)" />
            <input name="venueName" placeholder="Venue name" />
            <input name="venueAddress" placeholder="Venue address" />
            <input name="startsOn" type="date" />
            <input name="endsOn" type="date" />
            <textarea name="travelNotes" placeholder="Travel notes" rows={2} />
            <textarea name="transportNotes" placeholder="Transport notes" rows={2} />
            <button type="submit" disabled={!act || busy}>
              Add trip
            </button>
          </form>
        ) : null}

        {canManage && trip ? (
          <div className="log-inline-actions">
            <button
              type="button"
              className="log-link danger"
              disabled={!act || busy}
              onClick={() => {
                if (confirm(`Delete trip "${trip.title}" and its hotels/legs?`)) {
                  void run({ action: "delete_trip", orgId, id: trip.id }, `del-trip:${trip.id}`);
                }
              }}
            >
              Delete selected trip
            </button>
          </div>
        ) : null}

        {trip ? (
          <div className="log-trip-block">
            <header className="log-trip-meta">
              <h3>{trip.title}</h3>
              {(trip.venueName || trip.startsOn) && (
                <p className="app-muted">{[trip.venueName, trip.startsOn, trip.endsOn].filter(Boolean).join(" · ")}</p>
              )}
              {trip.travelNotes ? <p className="app-muted">{trip.travelNotes}</p> : null}
            </header>

            <section className="log-subpanel" aria-label="Hotels and rooming">
              <div className="log-subpanel-head">
                <h4>Hotels and rooming</h4>
                <span className="app-muted">
                  {trip.hotels.length} hotel{trip.hotels.length === 1 ? "" : "s"}
                </span>
              </div>
              {trip.hotels.length === 0 ? (
                <EmptyState
                  soft
                  title="No hotels for this trip"
                  description={
                    canManage
                      ? "Add the hotel block and rooming list so students can see their room."
                      : "Mentors add lodging when the room block is confirmed."
                  }
                />
              ) : (
                trip.hotels.map((hotel) => (
                  <HotelBlock
                    key={hotel.id}
                    hotel={hotel}
                    orgId={orgId}
                    members={members}
                    canManage={canManage}
                    act={act}
                    busy={busy}
                    run={run}
                  />
                ))
              )}

              {canManage ? (
                <form
                  className="log-grid-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    void run(
                      {
                        action: "create_hotel",
                        orgId,
                        tripId: trip.id,
                        name: String(fd.get("name") ?? ""),
                        address: String(fd.get("address") ?? ""),
                        phone: String(fd.get("phone") ?? ""),
                        confirmationCode: String(fd.get("confirmationCode") ?? ""),
                        checkInAt: String(fd.get("checkInAt") ?? "") || null,
                        checkOutAt: String(fd.get("checkOutAt") ?? "") || null,
                        roomBlockNotes: String(fd.get("roomBlockNotes") ?? ""),
                        notes: String(fd.get("notes") ?? ""),
                      },
                      `hotel:${trip.id}`,
                    ).then(() => e.currentTarget.reset());
                  }}
                >
                  <input name="name" placeholder="Hotel name" required />
                  <input name="address" placeholder="Address" />
                  <input name="phone" placeholder="Phone" />
                  <input name="confirmationCode" placeholder="Confirmation code" />
                  <input name="checkInAt" type="datetime-local" />
                  <input name="checkOutAt" type="datetime-local" />
                  <textarea name="roomBlockNotes" placeholder="Room block notes" rows={2} />
                  <button type="submit" disabled={!act || busy}>
                    Add hotel
                  </button>
                </form>
              ) : null}
            </section>

            <section className="log-subpanel" aria-label="Travel legs">
              <div className="log-subpanel-head">
                <h4>Get there and back</h4>
                <span className="app-muted">
                  {legs.length} travel time{legs.length === 1 ? "" : "s"}
                </span>
              </div>
              {legs.length === 0 ? (
                <EmptyState
                  soft
                  title="No timed legs yet"
                  description={
                    canManage
                      ? "Add leave / arrive times so they show on My Day and Team Calendar."
                      : "Mentors publish leave and arrive times before departure."
                  }
                >
                  <LogisticsRelated orgId={orgId} include={["my-day", "calendar"]} />
                </EmptyState>
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
                          disabled={!act || busy}
                          onClick={() => {
                            if (confirm(`Remove "${leg.title}"?`)) {
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
                    const fd = new FormData(e.currentTarget);
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
                        sortOrder: 0,
                      },
                      "leg",
                    ).then(() => e.currentTarget.reset());
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
                  <button type="submit" disabled={!act || busy}>
                    Add travel time
                  </button>
                </form>
              ) : null}
            </section>
          </div>
        ) : null}
      </Panel>
    </main>
  );
}

function HotelBlock({
  hotel,
  orgId,
  members,
  canManage,
  act,
  busy,
  run,
}: {
  hotel: Hotel;
  orgId: string;
  members: LogisticsMember[];
  canManage: boolean;
  act: boolean;
  busy: boolean;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const unassigned = hotel.rooms.filter((room) => !room.occupantUserId && !room.occupantName.trim()).length;
  return (
    <div className="log-hotel-block">
      <div className="log-hotel-head">
        <div>
          <strong>{hotel.name}</strong>
          {hotel.confirmationCode ? <span className="app-muted"> · Conf #{hotel.confirmationCode}</span> : null}
        </div>
        {canManage ? (
          <button
            type="button"
            className="log-link danger"
            disabled={!act || busy}
            onClick={() => {
              if (confirm(`Delete hotel "${hotel.name}"?`)) {
                void run({ action: "delete_hotel", orgId, id: hotel.id }, `del-hotel:${hotel.id}`);
              }
            }}
          >
            Delete hotel
          </button>
        ) : null}
      </div>
      {hotel.address ? <p className="app-muted">{hotel.address}</p> : null}
      {hotel.phone ? (
        <p>
          <a href={`tel:${hotel.phone.replace(/\s/g, "")}`}>{hotel.phone}</a>
        </p>
      ) : null}
      {(hotel.checkInAt || hotel.checkOutAt) && (
        <p className="app-muted">
          Check-in {fmtWhen(hotel.checkInAt)} · Check-out {fmtWhen(hotel.checkOutAt)}
        </p>
      )}
      {hotel.roomBlockNotes ? <p className="app-muted">{hotel.roomBlockNotes}</p> : null}
      {hotel.rooms.length === 0 ? (
        <p className="app-muted">No rooms in the block yet.</p>
      ) : (
        <>
          {unassigned > 0 && canManage ? (
            <p className="log-banner warn" role="status">
              {unassigned} unassigned room slot{unassigned === 1 ? "" : "s"} in this hotel.
            </p>
          ) : null}
          <ul className="logistics-list">
            {hotel.rooms.map((room) => (
              <li key={room.id}>
                <strong>Room {room.roomLabel}</strong>
                <span>
                  {room.occupantName || room.occupantUserId
                    ? memberLabel(
                        members.find((m) => m.userId === room.occupantUserId) ?? {
                          userId: room.occupantUserId ?? "",
                          name: room.occupantName,
                          email: null,
                          role: "",
                        },
                      )
                    : "Unassigned"}
                </span>
                {canManage ? (
                  <button
                    type="button"
                    className="log-link danger"
                    disabled={!act || busy}
                    onClick={() => void run({ action: "delete_room", orgId, id: room.id }, `del-room:${room.id}`)}
                  >
                    Remove room
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {canManage ? (
        <form
          className="log-grid-form"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void run(
              {
                action: "upsert_room",
                orgId,
                hotelId: hotel.id,
                roomLabel: String(fd.get("roomLabel") ?? ""),
                occupantUserId: String(fd.get("occupantUserId") || "") || null,
                occupantName: String(fd.get("occupantName") ?? ""),
                notes: String(fd.get("notes") ?? ""),
              },
              `room:${hotel.id}`,
            ).then(() => e.currentTarget.reset());
          }}
        >
          <input name="roomLabel" placeholder="Room label" required />
          <select name="occupantUserId" defaultValue="">
            <option value="">Assign member (optional)</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberLabel(m)}
              </option>
            ))}
          </select>
          <input name="occupantName" placeholder="Or type occupant name" />
          <input name="notes" placeholder="Notes" />
          <button type="submit" disabled={!act || busy}>
            Add / update room
          </button>
        </form>
      ) : null}
    </div>
  );
}
