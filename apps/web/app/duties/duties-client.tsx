"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader } from "../../components/ui";
import { DUTY_KIND_LABELS, type DutyAssignment, type DutyRosterView } from "../../lib/duty-roster-shared";
import { withOrgHref } from "../../lib/nav/product-nav";

export default function DutiesClient() {
  const [view, setView] = useState<DutyRosterView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    void fetch(`/api/duties${qs}`)
      .then(async (response) => {
        const data = (await response.json()) as DutyRosterView & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Could not load duties");
        setView(data);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load duties"));
  }, []);

  if (error) {
    return (
      <main className="module-page duties-page">
        <PageHeader navPath="/duties" title="Duty roster" />
        <EmptyState soft badge="Setup" badgeTone="setup" title="Could not load duty roster" description={error}>
          <div className="soft-btn-row">
            <a className="app-button secondary" href="/workspace">
              Choose workspace
            </a>
            <a className="app-button secondary" href="/help">
              Help
            </a>
          </div>
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page duties-page">
        <PageHeader navPath="/duties" title="Duty roster" />
        <EmptyState soft title="Opening duty roster…" description="Loading upcoming scouting, pit, and drive-team slots." aria-busy />
      </main>
    );
  }

  if (view.status !== "ready") {
    return (
      <main className="module-page duties-page">
        <PageHeader navPath="/duties" title="Duty roster" />
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message} description="Pick a team workspace, then return here or assign slots from Team Calendar.">
          <div className="soft-btn-row">
            <a className="app-button" href="/workspace">
              Choose workspace
            </a>
            <a className="app-button secondary" href={withOrgHref("/team?tab=calendar", view.orgId)}>
              Team calendar
            </a>
          </div>
        </EmptyState>
      </main>
    );
  }

  const needsAssignment = view.duties.filter((duty) => !duty.assignedUserId);
  const orgQ = `?orgId=${encodeURIComponent(view.orgId)}`;
  const calendarDutiesHref = `/team/calendar${orgQ}&tab=duties`;

  return (
    <main className="module-page duties-page">
      <PageHeader
        navPath="/duties"
        title="Duty roster"
        description="Upcoming scouting, pit, drive-team, and outreach slots — assign open ones from Team Calendar."
      >
        <div className="duties-links">
          <a className="app-button" href={calendarDutiesHref}>
            Assign on calendar
          </a>
          <a className="app-button secondary" href={`/logistics${orgQ}`}>
            Logistics
          </a>
          <a className="app-button secondary" href={`/packing${orgQ}`}>
            Packing
          </a>
        </div>
      </PageHeader>

      {needsAssignment.length > 0 ? (
        <p className="duties-warn" role="status">
          {needsAssignment.length} slot{needsAssignment.length === 1 ? "" : "s"} need assignment.{" "}
          <a href={calendarDutiesHref}>Open calendar duties</a>
        </p>
      ) : null}

      <section className="soft-panel">
        <h2>Needs assignment</h2>
        {needsAssignment.length === 0 ? (
          <p className="app-muted">Every upcoming duty has someone on it.</p>
        ) : (
          <DutyList duties={needsAssignment} calendarHref={calendarDutiesHref} />
        )}
      </section>

      <section className="soft-panel">
        <h2>All upcoming</h2>
        {view.duties.length === 0 ? (
          <EmptyState
            soft
            title="No duties scheduled yet"
            description="Create scouting, pit, or outreach slots on Team Calendar — this roster only shows real assignments."
          >
            <a className="app-button" href={calendarDutiesHref}>
              Open calendar duties
            </a>
          </EmptyState>
        ) : (
          <DutyList duties={view.duties} calendarHref={calendarDutiesHref} />
        )}
      </section>
    </main>
  );
}

function DutyList({ duties, calendarHref }: { duties: DutyAssignment[]; calendarHref: string }) {
  return (
    <ul className="duties-list">
      {duties.map((duty) => (
        <li key={duty.id}>
          <strong>{duty.title}</strong>
          <span>
            {DUTY_KIND_LABELS[duty.kind]}
            {duty.subteamName ? ` · ${duty.subteamName}` : ""}
            {" · "}
            {new Date(duty.startsAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          {duty.assignedUserName ? (
            <span>{duty.assignedUserName}</span>
          ) : (
            <a href={calendarHref}>Unassigned — assign</a>
          )}
        </li>
      ))}
    </ul>
  );
}
