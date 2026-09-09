"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { VisitRelated } from "../../components/visit-related";
import {
  CardGridSkeleton,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  StatRowSkeleton,
  StatTile,
} from "../../components/ui";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  VISIT_RELATED_INCLUDE,
  classifyVisitShell,
  visitInvitesShareHref,
  visitNextActions,
  visitSetupSteps,
  visitShellCopy,
  type VisitNextAction,
  type VisitShellKind,
} from "../../lib/visit-invites/visit-related";
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

function VisitNextActionsPanel({ actions }: { actions: VisitNextAction[] }) {
  if (actions.length === 0) return null;
  return (
    <Panel className="visit-next-actions edc-next-actions">
      <header>
        <h2>Next actions</h2>
        <p>Logistics, Event Day, and Calendar only — never DEMO invite rows.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function VisitShell({
  title,
  description,
  orgId,
  shell,
  canManage,
  visitCount,
  hostGaps,
  error,
  onRetry,
  children,
}: {
  title: string;
  description: string;
  orgId?: string | null;
  shell: VisitShellKind;
  canManage?: boolean;
  visitCount?: number;
  hostGaps?: number;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = visitNextActions({
    orgId,
    shell,
    canManage,
    visitCount,
    hostGaps,
  });
  const copy = visitShellCopy(shell);
  const steps = shell === "setup" || shell === "empty" ? visitSetupSteps(orgId) : [];
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";

  if (shell === "loading") {
    return (
      <main className="visit-page module-page soft-gate">
        <PageHeader navPath="/visit-invites" title="Visit Invites" description={copy.description}>
          <VisitRelated orgId={orgId} include={[...VISIT_RELATED_INCLUDE]} />
        </PageHeader>
        {children}
        <div style={{ display: "grid", gap: 16 }} aria-busy="true" aria-label="Loading visit invites">
          <StatRowSkeleton count={3} />
          <CardGridSkeleton cols={2} rows={1} />
        </div>
      </main>
    );
  }

  if (shell === "error") {
    return (
      <main className="visit-page module-page soft-gate">
        <PageHeader navPath="/visit-invites" title="Visit Invites" description={description}>
          <VisitRelated orgId={orgId} include={[...VISIT_RELATED_INCLUDE]} />
        </PageHeader>
        {children}
        <ErrorState title={title || copy.title} message={error || copy.description} onRetry={onRetry} />
        <VisitNextActionsPanel actions={actions} />
      </main>
    );
  }

  return (
    <main className="visit-page module-page">
      <PageHeader navPath="/visit-invites" title="Visit Invites" description={description}>
        <VisitRelated orgId={orgId} include={[...VISIT_RELATED_INCLUDE]} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup"
            : shell === "empty"
              ? "No visits yet"
              : copy.badge
        }
        badgeTone={shell === "setup" || shell === "empty" ? "setup" : ""}
        title={title || copy.title}
        description={description || copy.description}
      >
        <div className="visit-inline-actions">
          {shell === "setup" ? (
            <a className="app-button" href={workspaceHref}>
              Open Workspace
            </a>
          ) : null}
          {shell === "empty" && canManage ? (
            <a className="app-button" href={visitInvitesShareHref(orgId) + "#visit-create"}>
              Create the first visit
            </a>
          ) : null}
          {/* Related links stay in the header — repeating them here showed the
              same three or four buttons twice on one screen. */}
        </div>
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
      <VisitNextActionsPanel actions={actions} />
    </main>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function VisitInvitesClient() {
  const [view, setView] = useState<VisitInvitesView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [shareNote, setShareNote] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<VisitKind>("shop_tour");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("");
  const [status, setStatus] = useState<VisitStatus>("scheduled");
  const [syncToCalendar, setSyncToCalendar] = useState(true);

  const load = useCallback(async () => {
    setError("");
    const q = orgFromUrl();
    const url = q ? `/api/visit-invites?orgId=${encodeURIComponent(q)}` : "/api/visit-invites";
    try {
      const res = await fetch(url, { credentials: "include" });
      const data = (await res.json()) as VisitInvitesView & { error?: string };
      if (!res.ok || !("status" in data)) {
        setError(data.error ?? "Could not load visit invites");
        setFetchFailed(true);
        return;
      }
      setFetchFailed(false);
      setView(data);
    } catch {
      setFetchFailed(true);
      setError("Could not load visit invites");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      if (body.action === "upsert_visit") {
        setShareNote(
          body.status === "draft"
            ? "Draft saved for mentors only — switch to Scheduled, then share the board link when guests can RSVP."
            : syncToCalendar
              ? "Visit saved and queued for Calendar sync — copy the board or visit link to share with the team."
              : "Visit saved — copy the board or visit link to share. Enable Calendar sync next time to place an outreach block.",
        );
      }
    } finally {
      setBusyKey("");
    }
  };

  const busy = Boolean(busyKey);
  const urlOrgId = orgFromUrl();

  if (!view) {
    const shell = classifyVisitShell({
      loading: !fetchFailed,
      fetchFailed,
      status: null,
    });
    const copy = visitShellCopy(shell);
    return (
      <VisitShell
        title={copy.title}
        description={copy.description}
        orgId={urlOrgId}
        shell={shell}
        error={error}
        onRetry={() => void load()}
      />
    );
  }

  if (view.status === "setup_required") {
    const copy = visitShellCopy("setup");
    return (
      <VisitShell
        title={copy.title}
        description={view.message || copy.description}
        orgId={view.context.orgId}
        shell="setup"
      />
    );
  }

  const canManage = view.context.canManage;
  const orgId = view.context.orgId;
  const shell = classifyVisitShell({
    loading: false,
    status: "ready",
    visitCount: view.visits.length,
  });
  const nextActions = visitNextActions({
    orgId,
    shell,
    canManage,
    visitCount: view.visits.length,
    hostGaps: view.hostGaps,
  });
  const boardShareHref = visitInvitesShareHref(orgId);
  const boardShareUrl =
    typeof window !== "undefined" ? `${window.location.origin}${boardShareHref}` : boardShareHref;

  const shareBoard = async () => {
    const ok = await copyText(boardShareUrl);
    setShareNote(ok ? "Board link copied — share with mentors and members. Guests RSVP on Scheduled visits only." : boardShareUrl);
  };

  return (
    <main className="visit-page module-page">
      <PageHeader
        navPath="/visit-invites"
        title="Visit Invites"
        description={`${view.context.orgName} — shop tours, demo days, mentor hosts, and guest RSVPs. Real visits only — never DEMO invites.`}
      >
        <div className="visit-header-actions">
          <VisitRelated orgId={orgId} include={[...VISIT_RELATED_INCLUDE]} />
          <button type="button" className="app-button secondary" disabled={busy} onClick={() => void shareBoard()}>
            Copy board link
          </button>
        </div>
      </PageHeader>

      {error ? <p className="visit-warn" role="alert">{error}</p> : null}
      {shareNote ? <p className="visit-share-note" role="status">{shareNote}</p> : null}

      <div className="visit-summary">
        <StatTile flat={false} label="Upcoming" value={view.upcomingCount} />
        <StatTile flat={false} label="Total visits" value={view.visits.length} />
        <StatTile flat={false} label="Missing hosts" value={view.hostGaps} />
      </div>

      <section className="visit-share-panel" aria-label="Create and share">
        <header>
          <h2>Create and share</h2>
          <p>
            Mentors schedule real visits here. <strong>Draft</strong> stays planner-only;{" "}
            <strong>Scheduled</strong> opens member and guest RSVPs. Sync to Calendar for outreach blocks, then copy the
            board link — no DEMO invite placeholders.
          </p>
        </header>
        {/* "Copy board link" and the Calendar / Logistics / Event Day links are
            both in the page header, which is still on screen here. This panel is
            about creating a visit, so it keeps the words and drops the second
            copy of the same three controls. */}
      </section>

      {canManage ? (
        <form
          id="visit-create"
          className="visit-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() || !startsAt) return;
            void run(
              {
                action: "upsert_visit",
                orgId,
                title: title.trim(),
                kind,
                startsAt: new Date(startsAt).toISOString(),
                endsAt: endsAt ? new Date(endsAt).toISOString() : null,
                location: location.trim(),
                description: description.trim(),
                capacity: capacity === "" ? null : Number(capacity),
                status,
                syncToCalendar,
              },
              "upsert",
            ).then(() => {
              setTitle("");
              setDescription("");
              setCapacity("");
            });
          }}
        >
          <h2>Schedule a visit</h2>
          <p className="visit-form-lead">
            Title, start time, and status are required to publish. Empty boards stay empty until you create a real visit.
          </p>
          <div className="visit-grid">
            <label className="visit-field wide">
              <span>Title</span>
              <input value={title} disabled={busy} required onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="visit-field">
              <span>Kind</span>
              <select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as VisitKind)}>
                {VISIT_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {VISIT_KIND_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="visit-field">
              <span>Status</span>
              <select value={status} disabled={busy} onChange={(e) => setStatus(e.target.value as VisitStatus)}>
                {VISIT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {VISIT_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="visit-field">
              <span>Starts</span>
              <input
                type="datetime-local"
                value={startsAt}
                disabled={busy}
                required
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label className="visit-field">
              <span>Ends</span>
              <input type="datetime-local" value={endsAt} disabled={busy} onChange={(e) => setEndsAt(e.target.value)} />
            </label>
            <label className="visit-field">
              <span>Capacity</span>
              <input
                type="number"
                min={1}
                max={500}
                value={capacity}
                disabled={busy}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </label>
            <label className="visit-field wide">
              <span>Location</span>
              <input value={location} disabled={busy} onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label className="visit-field wide">
              <span>Description</span>
              <textarea value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
          <label className="visit-check">
            <input
              type="checkbox"
              checked={syncToCalendar}
              disabled={busy}
              onChange={(e) => setSyncToCalendar(e.target.checked)}
            />
            Sync to Team Calendar (outreach) when sharing
          </label>
          <div className="visit-form-actions">
            <button type="submit" className="app-button" disabled={busy || !title.trim() || !startsAt}>
              {status === "draft" ? "Save draft" : "Save and share-ready"}
            </button>
            <span className="visit-form-hint">
              {status === "draft"
                ? "Draft: mentors only — switch to Scheduled before copying guest links."
                : "Scheduled: members can RSVP; copy the visit link on each card."}
            </span>
          </div>
        </form>
      ) : null}

      {view.visits.length === 0 ? (
        <>
          <EmptyState
            soft
            badge="No visits yet"
            badgeTone="setup"
            title="No visits scheduled yet"
            description={
              canManage
                ? "Create a shop tour or demo day above — empty stays empty until someone schedules a real visit."
                : "Mentors will post real visits here. Nothing is pre-filled with DEMO invites."
            }
          >
            {/* One action out of an empty state. The related links live in the
                header for every state of this page. */}
            {canManage ? (
              <a className="app-button" href="#visit-create">
                Jump to create
              </a>
            ) : null}
          </EmptyState>
          <VisitNextActionsPanel actions={nextActions} />
        </>
      ) : (
        <>
          <ul className="visit-list">
            {view.visits.map((visit) => (
              <VisitCard
                key={visit.id}
                visit={visit}
                orgId={orgId}
                canManage={canManage}
                busy={busy}
                run={run}
                onShareNote={setShareNote}
              />
            ))}
          </ul>
          <VisitNextActionsPanel actions={nextActions} />
        </>
      )}
    </main>
  );
}

function VisitCard({
  visit,
  orgId,
  canManage,
  busy,
  run,
  onShareNote,
}: {
  visit: VisitInvite;
  orgId: string;
  canManage: boolean;
  busy: boolean;
  run: (body: ActionBody, key: string) => Promise<void>;
  onShareNote: (note: string) => void;
}) {
  const counts = rsvpCounts(visit.rsvps);
  const tone = capacityTone(counts.partyGoing, visit.capacity);
  const [hostName, setHostName] = useState("");
  const [studentName, setStudentName] = useState("");
  const [demoTitle, setDemoTitle] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [partySize, setPartySize] = useState("1");
  const shareHref = visitInvitesShareHref(orgId, visit.id);
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}${shareHref}` : shareHref;

  const setSelfRsvp = (response: RsvpResponse) => {
    void run(
      {
        action: "set_rsvp",
        orgId,
        visitId: visit.id,
        response,
        partySize: 1,
        guestName: "",
        guestEmail: "",
        note: "",
      },
      `rsvp:${visit.id}:${response}`,
    );
  };

  const copyVisitLink = async () => {
    const ok = await copyText(shareUrl);
    onShareNote(
      ok
        ? visit.status === "scheduled"
          ? `Link copied for “${visit.title}” — members can open Visit Invites and RSVP.`
          : `Link copied for “${visit.title}” — set status to Scheduled before guests RSVP.`
        : shareUrl,
    );
  };

  return (
    <li className="visit-card" id={`visit-${visit.id}`}>
      <div className="visit-card-head">
        <div>
          <h3>{visit.title}</h3>
          <p>
            {VISIT_KIND_LABELS[visit.kind]} · {fmtWhen(visit.startsAt)}
            {visit.location ? ` · ${visit.location}` : ""}
          </p>
        </div>
        <div className="visit-card-head-actions">
          <span className="visit-pill">{VISIT_STATUS_LABELS[visit.status]}</span>
          <button type="button" className="visit-link" disabled={busy} onClick={() => void copyVisitLink()}>
            Copy visit link
          </button>
        </div>
      </div>
      <div className={`visit-meta visit-tone-${tone}`}>
        <span>
          Going <b>{counts.going}</b>
        </span>
        <span>
          Party <b>{counts.partyGoing}</b>
          {visit.capacity != null ? ` / ${visit.capacity}` : ""}
        </span>
        <span>
          Hosts <b>{visit.hosts.length}</b>
        </span>
        {visit.calendarEventId ? <span className="visit-synced">On Calendar</span> : null}
      </div>
      {visitNeedsHost(visit) ? <p className="visit-warn">Needs a mentor host before guests arrive.</p> : null}
      {demoDayNeedsStudentDemo(visit) ? (
        <p className="visit-warn">Demo day still needs at least one student demo.</p>
      ) : null}
      <div className="visit-rsvp-actions">
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() => setSelfRsvp("going")}
        >
          {visit.myRsvp === "going" ? "You're going" : "I'm going"}
        </button>
        <button type="button" className="app-button secondary" disabled={busy} onClick={() => setSelfRsvp("maybe")}>
          Maybe
        </button>
        <button type="button" className="app-button secondary" disabled={busy} onClick={() => setSelfRsvp("no")}>
          Can&apos;t make it
        </button>
      </div>
      {canManage ? (
        <>
          <div className="visit-subform">
            <h4>Mentor hosts</h4>
            <ul className="visit-rows">
              {visit.hosts.map((host) => (
                <li key={host.id}>
                  <span>{host.hostName || "Host"}</span>
                  <button
                    type="button"
                    className="visit-link danger"
                    disabled={busy}
                    onClick={() => void run({ action: "remove_host", orgId, id: host.id }, `rh:${host.id}`)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="visit-grid"
              onSubmit={(e) => {
                e.preventDefault();
                if (!hostName.trim()) return;
                void run(
                  {
                    action: "add_host",
                    orgId,
                    visitId: visit.id,
                    hostName: hostName.trim(),
                    notes: "",
                    userId: null,
                  },
                  `ah:${visit.id}`,
                ).then(() => setHostName(""));
              }}
            >
              <label className="visit-field wide">
                <span>Host name</span>
                <input value={hostName} disabled={busy} onChange={(e) => setHostName(e.target.value)} />
              </label>
              <button type="submit" className="app-button secondary" disabled={busy || !hostName.trim()}>
                Add host
              </button>
            </form>
          </div>
          {visit.kind === "demo_day" ? (
            <div className="visit-subform">
              <h4>Student demos</h4>
              <ul className="visit-rows">
                {visit.demos.map((demo) => (
                  <li key={demo.id}>
                    <span>
                      {demo.demoTitle}
                      {demo.studentName ? ` · ${demo.studentName}` : ""}
                    </span>
                    <button
                      type="button"
                      className="visit-link danger"
                      disabled={busy}
                      onClick={() => void run({ action: "remove_demo", orgId, id: demo.id }, `rd:${demo.id}`)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="visit-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!demoTitle.trim()) return;
                  void run(
                    {
                      action: "add_demo",
                      orgId,
                      visitId: visit.id,
                      demoTitle: demoTitle.trim(),
                      studentName: studentName.trim(),
                      notes: "",
                      userId: null,
                      sortOrder: visit.demos.length,
                    },
                    `ad:${visit.id}`,
                  ).then(() => {
                    setDemoTitle("");
                    setStudentName("");
                  });
                }}
              >
                <label className="visit-field">
                  <span>Demo title</span>
                  <input value={demoTitle} disabled={busy} required onChange={(e) => setDemoTitle(e.target.value)} />
                </label>
                <label className="visit-field">
                  <span>Student</span>
                  <input value={studentName} disabled={busy} onChange={(e) => setStudentName(e.target.value)} />
                </label>
                <button type="submit" className="app-button secondary" disabled={busy || !demoTitle.trim()}>
                  Add demo
                </button>
              </form>
            </div>
          ) : null}
          <div className="visit-subform">
            <h4>Guest RSVP</h4>
            <form
              className="visit-grid"
              onSubmit={(e) => {
                e.preventDefault();
                if (!guestName.trim()) return;
                void run(
                  {
                    action: "set_rsvp",
                    orgId,
                    visitId: visit.id,
                    response: "going",
                    partySize: partySize === "" ? 1 : Number(partySize),
                    guestName: guestName.trim(),
                    guestEmail: guestEmail.trim(),
                    note: "",
                    userId: null,
                  },
                  `guest:${visit.id}`,
                ).then(() => {
                  setGuestName("");
                  setGuestEmail("");
                  setPartySize("1");
                });
              }}
            >
              <label className="visit-field">
                <span>Guest name</span>
                <input value={guestName} disabled={busy} required onChange={(e) => setGuestName(e.target.value)} />
              </label>
              <label className="visit-field">
                <span>Email</span>
                <input
                  type="email"
                  value={guestEmail}
                  disabled={busy}
                  onChange={(e) => setGuestEmail(e.target.value)}
                />
              </label>
              <label className="visit-field">
                <span>Party size</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={partySize}
                  disabled={busy}
                  onChange={(e) => setPartySize(e.target.value)}
                />
              </label>
              <button type="submit" className="app-button secondary" disabled={busy || !guestName.trim()}>
                Add guest
              </button>
            </form>
            <ul className="visit-rows">
              {visit.rsvps.map((rsvp) => (
                <li key={rsvp.id}>
                  <span>
                    {rsvp.guestName || "Member"} · {rsvp.response}
                  </span>
                  <button
                    type="button"
                    className="visit-link danger"
                    disabled={busy}
                    onClick={() => void run({ action: "remove_rsvp", orgId, id: rsvp.id }, `rr:${rsvp.id}`)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="visit-link danger"
            disabled={busy}
            onClick={() => {
              if (confirm(`Delete "${visit.title}"?`)) {
                void run({ action: "delete_visit", orgId, id: visit.id }, `del:${visit.id}`);
              }
            }}
          >
            Delete visit
          </button>
        </>
      ) : (
        <ul className="visit-rows">
          {visit.hosts.map((host) => (
            <li key={host.id}>
              <span>Host: {host.hostName || "Mentor"}</span>
            </li>
          ))}
          {visit.demos.map((demo) => (
            <li key={demo.id}>
              <span>Demo: {demo.demoTitle}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
