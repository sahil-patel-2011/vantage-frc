"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "../../components/ui";
import { PageHeader } from "../../components/ui/page-header";
import {
  VISIT_KIND_LABELS,
  VISIT_KINDS,
  VISIT_STATUS_LABELS,
  VISIT_STATUSES,
  capacityTone,
  demoDayNeedsStudentDemo,
  rsvpCounts,
  visitNeedsHost,
  type VisitInvite,
  type VisitInvitesView,
  type VisitKind,
  type VisitStatus,
  type RsvpResponse,
} from "../../lib/visit-invites";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

function orgFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("orgId");
}

function fmtWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function VisitInvitesClient() {
  const [view, setView] = useState<VisitInvitesView | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<VisitKind>("shop_tour");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("");
  const [status, setStatus] = useState<VisitStatus>("scheduled");
  const [syncToCalendar, setSyncToCalendar] = useState(true);
  const orgId = view && view.status === "ready" ? view.context.orgId : orgFromUrl();

  const load = async () => {
    setError("");
    const q = orgFromUrl();
    const url = q ? `/api/visit-invites?orgId=${encodeURIComponent(q)}` : "/api/visit-invites";
    const res = await fetch(url, { credentials: "include" });
    const data = (await res.json()) as VisitInvitesView & { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not load visit invites");
      return;
    }
    setView(data);
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (body: ActionBody, key: string) => {
    setBusyKey(key);
    setError("");
    try {
      const res = await fetch("/api/visit-invites", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as VisitInvitesView & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      setView(data);
    } finally {
      setBusyKey("");
    }
  };

  const busy = Boolean(busyKey);

  if (error && !view) {
    return (
      <main className="visit-page module-page">
        <PageHeader navPath="/visit-invites" title="Visit Invites" description={error} />
        <EmptyState soft title="Could not load visit invites" description={error}>
          <button type="button" className="app-button" onClick={() => void load()}>Retry</button>
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="visit-page module-page">
        <PageHeader navPath="/visit-invites" title="Visit Invites" description="Loading shop tours and demo days?" />
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="visit-page module-page">
        <PageHeader navPath="/visit-invites" title="Visit Invites" description={view.message} />
        <EmptyState soft title="Visit invites not ready" description={view.message} />
      </main>
    );
  }

  const canManage = view.context.canManage;

  return (
    <main className="visit-page module-page">
      <PageHeader
        navPath="/visit-invites"
        title="Visit Invites"
        description="Come see what we do ? shop tours, demo days, mentor hosts, and guest RSVPs."
      >
        <a className="app-button secondary" href={orgId ? `/team/calendar?orgId=${encodeURIComponent(orgId)}` : "/team/calendar"}>Team calendar</a>
        <a className="app-button secondary" href={orgId ? `/logistics?orgId=${encodeURIComponent(orgId)}` : "/logistics"}>Event logistics</a>
      </PageHeader>
      {error ? <p className="visit-warn">{error}</p> : null}
      <div className="visit-summary">
        <div className="visit-tile"><strong>{view.upcomingCount}</strong><span>Upcoming</span></div>
        <div className="visit-tile"><strong>{view.visits.length}</strong><span>Total visits</span></div>
        <div className="visit-tile"><strong>{view.hostGaps}</strong><span>Missing hosts</span></div>
      </div>
      {canManage ? (
        <form className="visit-form" onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || !startsAt) return;
          void run({
            action: "upsert_visit", orgId: view.context.orgId, title: title.trim(), kind,
            startsAt: new Date(startsAt).toISOString(),
            endsAt: endsAt ? new Date(endsAt).toISOString() : null,
            location: location.trim(), description: description.trim(),
            capacity: capacity === "" ? null : Number(capacity), status, syncToCalendar,
          }, "upsert").then(() => { setTitle(""); setDescription(""); setCapacity(""); });
        }}>
          <h2>Schedule a visit</h2>
          <div className="visit-grid">
            <label className="visit-field wide"><span>Title</span>
              <input value={title} disabled={busy} required onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="visit-field"><span>Kind</span>
              <select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as VisitKind)}>
                {VISIT_KINDS.map((value) => <option key={value} value={value}>{VISIT_KIND_LABELS[value]}</option>)}
              </select>
            </label>
            <label className="visit-field"><span>Status</span>
              <select value={status} disabled={busy} onChange={(e) => setStatus(e.target.value as VisitStatus)}>
                {VISIT_STATUSES.map((value) => <option key={value} value={value}>{VISIT_STATUS_LABELS[value]}</option>)}
              </select>
            </label>
            <label className="visit-field"><span>Starts</span>
              <input type="datetime-local" value={startsAt} disabled={busy} required onChange={(e) => setStartsAt(e.target.value)} />
            </label>
            <label className="visit-field"><span>Ends</span>
              <input type="datetime-local" value={endsAt} disabled={busy} onChange={(e) => setEndsAt(e.target.value)} />
            </label>
            <label className="visit-field"><span>Capacity</span>
              <input type="number" min={1} max={500} value={capacity} disabled={busy} onChange={(e) => setCapacity(e.target.value)} />
            </label>
            <label className="visit-field wide"><span>Location</span>
              <input value={location} disabled={busy} onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label className="visit-field wide"><span>Description</span>
              <textarea value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
          <label className="visit-check">
            <input type="checkbox" checked={syncToCalendar} disabled={busy} onChange={(e) => setSyncToCalendar(e.target.checked)} />
            Sync to team calendar (outreach)
          </label>
          <button type="submit" className="app-button" disabled={busy || !title.trim() || !startsAt}>Save visit</button>
        </form>
      ) : null}
      {view.visits.length === 0 ? (
        <EmptyState soft title="No visits scheduled yet" description={canManage ? "Schedule a shop tour or demo day." : "Mentors will post visits here."} />
      ) : (
        <ul className="visit-list">
          {view.visits.map((visit) => (
            <VisitCard key={visit.id} visit={visit} orgId={view.context.orgId} canManage={canManage} busy={busy} run={run} />
          ))}
        </ul>
      )}
    </main>
  );
}

function VisitCard({ visit, orgId, canManage, busy, run }: {
  visit: VisitInvite; orgId: string; canManage: boolean; busy: boolean;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const counts = rsvpCounts(visit.rsvps);
  const tone = capacityTone(counts.partyGoing, visit.capacity);
  const [hostName, setHostName] = useState("");
  const [studentName, setStudentName] = useState("");
  const [demoTitle, setDemoTitle] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [partySize, setPartySize] = useState("1");
  const setSelfRsvp = (response: RsvpResponse) => {
    void run({ action: "set_rsvp", orgId, visitId: visit.id, response, partySize: 1, guestName: "", guestEmail: "", note: "" }, `rsvp:${visit.id}:${response}`);
  };
  return (
    <li className="visit-card">
      <div className="visit-card-head">
        <div>
          <h3>{visit.title}</h3>
          <p>{VISIT_KIND_LABELS[visit.kind]} ? {fmtWhen(visit.startsAt)}{visit.location ? ` ? ${visit.location}` : ""}</p>
        </div>
        <span className="visit-pill">{VISIT_STATUS_LABELS[visit.status]}</span>
      </div>
      <div className={`visit-meta visit-tone-${tone}`}>
        <span>Going <b>{counts.going}</b></span>
        <span>Party <b>{counts.partyGoing}</b>{visit.capacity != null ? ` / ${visit.capacity}` : ""}</span>
        <span>Hosts <b>{visit.hosts.length}</b></span>
      </div>
      {visitNeedsHost(visit) ? <p className="visit-warn">Needs a mentor host before guests arrive.</p> : null}
      {demoDayNeedsStudentDemo(visit) ? <p className="visit-warn">Demo day still needs at least one student demo.</p> : null}
      <div className="visit-rsvp-actions">
        <button type="button" className="app-button secondary" disabled={busy} onClick={() => setSelfRsvp("going")}>{visit.myRsvp === "going" ? "You're going" : "I'm going"}</button>
        <button type="button" className="app-button secondary" disabled={busy} onClick={() => setSelfRsvp("maybe")}>Maybe</button>
        <button type="button" className="app-button secondary" disabled={busy} onClick={() => setSelfRsvp("no")}>Can't make it</button>
      </div>
      {canManage ? (
        <>
          <div className="visit-subform">
            <h4>Mentor hosts</h4>
            <ul className="visit-rows">{visit.hosts.map((host) => (
              <li key={host.id}><span>{host.hostName || "Host"}</span>
                <button type="button" className="visit-link danger" disabled={busy} onClick={() => void run({ action: "remove_host", orgId, id: host.id }, `rh:${host.id}`)}>Remove</button>
              </li>
            ))}</ul>
            <form className="visit-grid" onSubmit={(e) => { e.preventDefault(); if (!hostName.trim()) return; void run({ action: "add_host", orgId, visitId: visit.id, hostName: hostName.trim(), notes: "", userId: null }, `ah:${visit.id}`).then(() => setHostName("")); }}>
              <label className="visit-field wide"><span>Host name</span><input value={hostName} disabled={busy} onChange={(e) => setHostName(e.target.value)} /></label>
              <button type="submit" className="app-button secondary" disabled={busy || !hostName.trim()}>Add host</button>
            </form>
          </div>
          {visit.kind === "demo_day" ? (
            <div className="visit-subform">
              <h4>Student demos</h4>
              <ul className="visit-rows">{visit.demos.map((demo) => (
                <li key={demo.id}><span>{demo.demoTitle}{demo.studentName ? ` ? ${demo.studentName}` : ""}</span>
                  <button type="button" className="visit-link danger" disabled={busy} onClick={() => void run({ action: "remove_demo", orgId, id: demo.id }, `rd:${demo.id}`)}>Remove</button>
                </li>
              ))}</ul>
              <form className="visit-grid" onSubmit={(e) => { e.preventDefault(); if (!demoTitle.trim()) return; void run({ action: "add_demo", orgId, visitId: visit.id, demoTitle: demoTitle.trim(), studentName: studentName.trim(), notes: "", userId: null, sortOrder: visit.demos.length }, `ad:${visit.id}`).then(() => { setDemoTitle(""); setStudentName(""); }); }}>
                <label className="visit-field"><span>Demo title</span><input value={demoTitle} disabled={busy} required onChange={(e) => setDemoTitle(e.target.value)} /></label>
                <label className="visit-field"><span>Student</span><input value={studentName} disabled={busy} onChange={(e) => setStudentName(e.target.value)} /></label>
                <button type="submit" className="app-button secondary" disabled={busy || !demoTitle.trim()}>Add demo</button>
              </form>
            </div>
          ) : null}
          <div className="visit-subform">
            <h4>Guest RSVP</h4>
            <form className="visit-grid" onSubmit={(e) => { e.preventDefault(); if (!guestName.trim()) return; void run({ action: "set_rsvp", orgId, visitId: visit.id, response: "going", partySize: partySize === "" ? 1 : Number(partySize), guestName: guestName.trim(), guestEmail: guestEmail.trim(), note: "", userId: null }, `guest:${visit.id}`).then(() => { setGuestName(""); setGuestEmail(""); setPartySize("1"); }); }}>
              <label className="visit-field"><span>Guest name</span><input value={guestName} disabled={busy} required onChange={(e) => setGuestName(e.target.value)} /></label>
              <label className="visit-field"><span>Email</span><input type="email" value={guestEmail} disabled={busy} onChange={(e) => setGuestEmail(e.target.value)} /></label>
              <label className="visit-field"><span>Party size</span><input type="number" min={1} max={50} value={partySize} disabled={busy} onChange={(e) => setPartySize(e.target.value)} /></label>
              <button type="submit" className="app-button secondary" disabled={busy || !guestName.trim()}>Add guest</button>
            </form>
            <ul className="visit-rows">{visit.rsvps.map((rsvp) => (
              <li key={rsvp.id}><span>{rsvp.guestName || "Member"} ? {rsvp.response}</span>
                <button type="button" className="visit-link danger" disabled={busy} onClick={() => void run({ action: "remove_rsvp", orgId, id: rsvp.id }, `rr:${rsvp.id}`)}>Remove</button>
              </li>
            ))}</ul>
          </div>
          <button type="button" className="visit-link danger" disabled={busy} onClick={() => { if (confirm(`Delete "${visit.title}"?`)) void run({ action: "delete_visit", orgId, id: visit.id }, `del:${visit.id}`); }}>Delete visit</button>
        </>
      ) : (
        <ul className="visit-rows">
          {visit.hosts.map((host) => <li key={host.id}><span>Host: {host.hostName || "Mentor"}</span></li>)}
          {visit.demos.map((demo) => <li key={demo.id}><span>Demo: {demo.demoTitle}</span></li>)}
        </ul>
      )}
    </li>
  );
}
