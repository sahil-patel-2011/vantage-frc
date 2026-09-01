"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { alumniShellCopy } from "../../lib/alumni";
import { alumniStatusLabel, mentorSlotStatusLabel } from "../../lib/alumni-network";
import {
  ALUMNI_STATUSES,
  MENTOR_SLOT_STATUSES,
  type AlumniNetworkView,
} from "../../lib/alumni-network/compute-alumni-network";
import type { AlumniStatus, MentorSlotStatus } from "../../lib/alumni-network/types";

type LiveView = Extract<AlumniNetworkView, { status: "live" }>;

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export default function AlumniNetworkClient() {
  const [view, setView] = useState<AlumniNetworkView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/alumni-network${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as AlumniNetworkView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setLoadStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => {
        setLoadStatus(null);
        setLoadError("");
        setFetchFailed(true);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/alumni-network", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as AlumniNetworkView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Alumni Network"}
          </>
        }
        title="Alumni Network"
        description="Keep track of graduated members who stay reachable — and log the mentor availability windows they've offered back to the team."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const kind = classifyLoadFailure({
            status: loadStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          });
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          {view.teamDirectory.length > 0 ? (
            <TeamDirectoryImport view={view} busy={busy} mutate={mutate} />
          ) : null}
          <AddProfileForm busy={busy} mutate={mutate} />
          {view.summary.totalAlumni > 0 ? <MentorSlotForm view={view} busy={busy} mutate={mutate} /> : null}
          <ProfileList view={view} busy={busy} mutate={mutate} />
          <MentorSlotList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function TeamDirectoryImport({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Import from team directory</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        These alumni are in your team's shared directory but not yet in the network. Import to add mentor
        availability and richer profile fields.
      </p>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {view.teamDirectory.map((alum) => (
          <li key={alum.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{alum.fullName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {alum.gradYear ? `Class of ${alum.gradYear}` : "Grad year unknown"}
                {alum.currentRole ? ` · ${alum.currentRole}` : ""}
                {alum.isMentor ? " · Mentor" : ""}
                {alum.mentorTopic ? ` · ${alum.mentorTopic}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() =>
                mutate({
                  action: "add-profile",
                  fullName: alum.fullName,
                  graduationYear: alum.gradYear ?? undefined,
                  roleWhileActive: alum.currentRole ?? undefined,
                  email: alum.email ?? undefined,
                  linkedinUrl: alum.linkedinUrl ?? undefined,
                  mentorAvailable: alum.isMentor,
                  mentorFocusAreas: alum.mentorTopic ? [alum.mentorTopic] : [],
                  status: "active",
                })
              }
            >
              Import
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Alumni", value: String(summary.totalAlumni) },
    { label: "Active", value: String(summary.activeAlumni) },
    { label: "Mentors available", value: `${summary.mentorsAvailable} (${pct(summary.mentorsAvailable, summary.totalAlumni)})` },
    { label: "Open mentor slots", value: String(summary.openMentorSlots) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {summary.byFocusArea.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Mentor focus areas</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {summary.byFocusArea.slice(0, 8).map((row) => (
              <li key={row.focusArea}>
                {row.focusArea} · {row.count}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function ProfileList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.profiles.length === 0) {
    const copy = alumniShellCopy("empty");
    return (
      <EmptyState badge={copy.badge} badgeTone="setup" title={copy.title} description={copy.description} />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Alumni directory</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.profiles.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.fullName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.graduationYear ? `Class of ${item.graduationYear}` : "Grad year unknown"}
                {item.roleWhileActive ? ` · ${item.roleWhileActive}` : ""}
                {item.currentOccupation ? ` · ${item.currentOccupation}` : ""}
              </small>
              <small className="app-muted">
                {alumniStatusLabel(item.status)}
                {item.mentorAvailable ? " · Mentor available" : ""}
                {item.mentorFocusAreas.length ? ` · ${item.mentorFocusAreas.join(", ")}` : ""}
              </small>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  mutate({
                    action: "update-profile",
                    profileId: item.id,
                    mentorAvailable: !item.mentorAvailable,
                    status: item.status,
                  })
                }
              >
                {item.mentorAvailable ? "Mark unavailable" : "Mark mentor-available"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove "${item.fullName}" from the directory?`)) {
                    mutate({ action: "delete-profile", profileId: item.id });
                  }
                }}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MentorSlotList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.mentorSlots.length === 0) {
    return (
      <EmptyState
        badge="No mentor slots yet"
        badgeTone="setup"
        title="Log a mentor availability window"
        description="Once alumni are added, log the office-hours or review windows they've offered."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Mentor availability</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.mentorSlots.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.topic}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.profileName} · {item.availableFrom}
                {item.availableTo ? ` – ${item.availableTo}` : ""} · {mentorSlotStatusLabel(item.status)}
              </small>
              {item.notes ? <small className="app-muted">{item.notes}</small> : null}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                value={item.status}
                disabled={busy}
                onChange={(event) =>
                  mutate({
                    action: "update-mentor-slot-status",
                    slotId: item.id,
                    status: event.target.value as MentorSlotStatus,
                  })
                }
              >
                {MENTOR_SLOT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {mentorSlotStatusLabel(status)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${item.topic}"?`)) {
                    mutate({ action: "delete-mentor-slot", slotId: item.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AddProfileForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      fullName: "",
      graduationYear: "",
      roleWhileActive: "",
      currentOccupation: "",
      currentLocation: "",
      email: "",
      linkedinUrl: "",
      mentorFocusAreas: "",
      bio: "",
      status: "active" as AlumniStatus,
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const [mentorAvailable, setMentorAvailable] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.fullName.trim()) return;
        mutate({
          action: "add-profile",
          fullName: form.fullName,
          graduationYear: form.graduationYear ? Number(form.graduationYear) : undefined,
          roleWhileActive: form.roleWhileActive || undefined,
          currentOccupation: form.currentOccupation || undefined,
          currentLocation: form.currentLocation || undefined,
          email: form.email || undefined,
          linkedinUrl: form.linkedinUrl || undefined,
          mentorAvailable,
          mentorFocusAreas: form.mentorFocusAreas
            ? form.mentorFocusAreas.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
          bio: form.bio || undefined,
          status: form.status,
        });
        setForm(empty);
        setMentorAvailable(false);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add alumni profile</h2>
      <FormGrid min={160}>
        <FormRow label="Full name">
          <input value={form.fullName} onChange={set("fullName")} placeholder="Ada Lovelace" required />
        </FormRow>
        <FormRow label="Graduation year">
          <input type="number" min={1950} max={2100} value={form.graduationYear} onChange={set("graduationYear")} />
        </FormRow>
        <FormRow label="Role while active">
          <input value={form.roleWhileActive} onChange={set("roleWhileActive")} placeholder="Captain" />
        </FormRow>
        <FormRow label="Current occupation">
          <input value={form.currentOccupation} onChange={set("currentOccupation")} />
        </FormRow>
        <FormRow label="Current location">
          <input value={form.currentLocation} onChange={set("currentLocation")} />
        </FormRow>
        <FormRow label="Email">
          <input type="email" value={form.email} onChange={set("email")} />
        </FormRow>
        <FormRow label="LinkedIn URL">
          <input value={form.linkedinUrl} onChange={set("linkedinUrl")} />
        </FormRow>
        <FormRow label="Mentor focus areas (comma-separated)">
          <input value={form.mentorFocusAreas} onChange={set("mentorFocusAreas")} placeholder="CAD, Programming" />
        </FormRow>
        <FormRow label="Status">
          <select value={form.status} onChange={set("status")}>
            {ALUMNI_STATUSES.map((status) => (
              <option key={status} value={status}>
                {alumniStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Bio (optional)">
        <textarea value={form.bio} onChange={set("bio")} rows={2} />
      </FormRow>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={mentorAvailable} onChange={(event) => setMentorAvailable(event.target.checked)} />
        Available to mentor
      </label>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.fullName.trim()}>
          Add profile
        </button>
      </div>
    </Panel>
  );
}

function MentorSlotForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      profileId: view.profiles[0]?.id ?? "",
      topic: "",
      availableFrom: "",
      availableTo: "",
      notes: "",
    }),
    [view.profiles],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.profileId || !form.topic.trim() || !form.availableFrom) return;
        mutate({
          action: "add-mentor-slot",
          profileId: form.profileId,
          topic: form.topic,
          availableFrom: form.availableFrom,
          availableTo: form.availableTo || undefined,
          notes: form.notes || undefined,
        });
        setForm({ ...empty, topic: "", availableFrom: "", availableTo: "", notes: "" });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log mentor availability</h2>
      <FormGrid min={160}>
        <FormRow label="Alumni">
          <select value={form.profileId} onChange={set("profileId")}>
            {view.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.fullName}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Topic">
          <input value={form.topic} onChange={set("topic")} placeholder="CAD review office hours" required />
        </FormRow>
        <FormRow label="Available from">
          <input type="date" value={form.availableFrom} onChange={set("availableFrom")} required />
        </FormRow>
        <FormRow label="Available to (optional)">
          <input type="date" value={form.availableTo} onChange={set("availableTo")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.topic.trim() || !form.availableFrom}>
          Log availability
        </button>
      </div>
    </Panel>
  );
}
