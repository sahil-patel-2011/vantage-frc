"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "../../components/ui/page-header";
import { DUTY_KIND_LABELS, type DutyAssignment, type DutyRosterView } from "../../lib/duty-roster-shared";

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
        <PageHeader navPath="/duties" title="Duty roster" description={error} />
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page duties-page">
        <PageHeader navPath="/duties" title="Duty roster" description="Loading assignments…" />
      </main>
    );
  }

  if (view.status !== "ready") {
    return (
      <main className="module-page duties-page">
        <PageHeader navPath="/duties" title="Duty roster" description={view.message} />
      </main>
    );
  }

  const needsAssignment = view.duties.filter((duty) => !duty.assignedUserId);
  const orgQ = `?orgId=${encodeURIComponent(view.orgId)}`;

  return (
    <main className="module-page duties-page">
      <PageHeader
        navPath="/duties"
        title="Duty roster"
        description="Upcoming scouting, pit, drive-team, and outreach slots — open ones need an assignee."
      >
        <div className="duties-links">
          <a className="app-button secondary" href={`/logistics${orgQ}`}>
            Logistics
          </a>
          <a className="app-button secondary" href={`/packing${orgQ}`}>
            Packing
          </a>
          <a className="app-button secondary" href={`/team/calendar${orgQ}`}>
            Calendar
          </a>
        </div>
      </PageHeader>

      {needsAssignment.length > 0 ? (
        <p className="duties-warn" role="status">
          {needsAssignment.length} slot{needsAssignment.length === 1 ? "" : "s"} need assignment.
        </p>
      ) : null}

      <section className="soft-panel">
        <h2>Needs assignment</h2>
        {needsAssignment.length === 0 ? (
          <p className="app-muted">Every upcoming duty has someone on it.</p>
        ) : (
          <DutyList duties={needsAssignment} />
        )}
      </section>

      <section className="soft-panel">
        <h2>All upcoming</h2>
        {view.duties.length === 0 ? (
          <p className="app-muted">No duties scheduled yet.</p>
        ) : (
          <DutyList duties={view.duties} />
        )}
      </section>
    </main>
  );
}

function DutyList({ duties }: { duties: DutyAssignment[] }) {
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
          <span>{duty.assignedUserName ?? "Unassigned"}</span>
        </li>
      ))}
    </ul>
  );
}
