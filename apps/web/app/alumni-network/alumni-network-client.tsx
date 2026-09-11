"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { alumniShellCopy } from "../../lib/alumni";
import { alumniStatusLabel, mentorSlotStatusLabel } from "../../lib/alumni-network";
import {
  ALUMNI_STATUSES,
  MENTOR_SLOT_STATUSES,
  type AlumniNetworkView,
} from "../../lib/alumni-network/compute-alumni-network";
import type { AlumniStatus, MentorSlotStatus } from "../../lib/alumni-network/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<AlumniNetworkView, { status: "live" }>;

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function isAlumniNetworkView(value: unknown): value is AlumniNetworkView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function alumniNetworkCacheOrg(data: AlumniNetworkView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistAlumniNetworkSnapshot(orgHint: string, data: AlumniNetworkView): Promise<void> {
  const cacheOrg = alumniNetworkCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("alumni-network", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("alumni-network", "_", data);
  } catch {
    // Live Alumni Network already painted; IndexedDB is best-effort.
  }
}

function AlumniNetworkRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related people tools">
      <Button as="a" variant="secondary" href={hubHref("/team", "exit-interview", orgId)}>
        Exit interviews
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "mentor-hours", orgId)}>
        Mentor hours
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/team/alumni", orgId)}>
        Team alumni
      </Button>
    </nav>
  );
}

function AlumniNetworkNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "add",
      label: "Add an alumni profile",
      detail: "Record a graduate who still wants to hear from the team.",
      href: "#alumni-add-profile",
      primary: true,
    },
    {
      id: "exit",
      label: "Open Exit interviews",
      detail: "Graduation handoff pages become the alumni knowledge trail.",
      href: hubHref("/team", "exit-interview", orgId),
      primary: false,
    },
    {
      id: "hours",
      label: "Open Mentor hours",
      detail: "Adult volunteer time is a separate ledger from student shop hours.",
      href: hubHref("/team", "mentor-hours", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function AlumniNetworkClient() {
  const [view, setView] = useState<AlumniNetworkView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<AlumniNetworkView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<AlumniNetworkView>("alumni-network", orgHint || "_");
      if (!viewRef.current && cached?.data && isAlumniNetworkView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      const response = await fetch(`/api/alumni-network${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      if (!response.ok || !isAlumniNetworkView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Alumni Network. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistAlumniNetworkSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Alumni Network. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isAlumniNetworkView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setFromCache(false);
        void persistAlumniNetworkSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  const teamHref = orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={teamHref}>Team</a>
          {" / Alumni Network"}
        </>
      }
      title="Alumni Network"
      description="Keep track of graduated members who stay reachable — and log the mentor availability windows they've offered back to the team."
    >
      <AlumniNetworkRelated orgId={orgId} />
    </PageHeader>
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: failureStatus,
            message: failureMessage,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: failureMessage || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Alumni Network" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Alumni Network" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Alumni Network" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <AlumniNetworkNextActions orgId={view.orgId} />
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
      id="alumni-add-profile"
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
        <Button variant="primary" type="submit" disabled={busy || !form.fullName.trim()}>
          Add profile
        </Button>
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
        <Button variant="primary" type="submit" disabled={busy || !form.topic.trim() || !form.availableFrom}>
          Log availability
        </Button>
      </div>
    </Panel>
  );
}
