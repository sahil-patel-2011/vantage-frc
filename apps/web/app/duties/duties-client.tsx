"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  EmptyState,
  FormGrid,
  PageHeader,
  Panel,
  SelectField,
  TextareaField,
  TextField, Button } from "../../components/ui";
import {
  ROSTER_KIND_LABELS,
  WATCH_KIND_LABELS,
  type DutiesView,
  type DutyRosterSlot,
  type DutyWatch,
  type WatchKind,
} from "../../lib/duties";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type ReadyView = Extract<DutiesView, { status: "ready" }>;

function isDutiesView(value: unknown): value is DutiesView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function dutiesCacheOrg(data: DutiesView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistDutiesSnapshot(orgHint: string, data: DutiesView): Promise<void> {
  const cacheOrg = dutiesCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("duties", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("duties", "_", data);
  } catch {
    // Live Duties already painted; IndexedDB is best-effort.
  }
}

function memberLabel(member: { name: string | null; email: string | null }): string {
  return member.name?.trim() || member.email?.trim() || "Teammate";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DutiesClient() {
  const [view, setView] = useState<DutiesView | null>(null);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<DutiesView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const qs = orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<DutiesView>("duties", orgHint || "_");
      if (!viewRef.current && cached?.data && isDutiesView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setError("");
    setErrorStatus(null);
    try {
      const response = await fetch(`/api/duties${qs}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setErrorStatus(response.status);
        setError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load duties",
        );
        return;
      }
      if (!response.ok || !isDutiesView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Duties. Showing the last copy on this device.");
          return;
        }
        setErrorStatus(response.status);
        setError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load duties",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistDutiesSnapshot(orgHint, data);
    } catch (err: unknown) {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Duties. Showing the last copy on this device.");
        return;
      }
      setError(err instanceof Error ? err.message : "Could not load duties");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    (payload: Record<string, unknown>) => {
      if (busy) return;
      const orgId = view && view.status === "ready" ? view.orgId : null;
      if (!orgId) return;
      setBusy(true);
      setError("");
      void fetch("/api/duties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      })
        .then(async (response) => {
          const data: unknown = await response.json().catch(() => null);
          if (!response.ok || !isDutiesView(data)) {
            setErrorStatus(response.status);
            throw new Error(
              data && typeof data === "object" && "error" in data && typeof data.error === "string"
                ? data.error
                : "Could not save assignment",
            );
          }
          setView(data);
          setFromCache(false);
          void persistDutiesSnapshot(orgId, data);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save assignment"))
        .finally(() => setBusy(false));
    },
    [busy, view],
  );

  if (error && !view) {
    const failure = loadFailureCopy(
      classifyLoadFailure({
        status: errorStatus,
        message: error,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      }),
      {
        nextPath:
          typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
        message: error,
      },
    );
    return (
      <main className="module-page duties-page">
        <PageHeader navPath="/duties" title="Duties" />
        <OfflineBanner feature="Duties" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge={
            failure.kind === "auth" ? "Signed out" : failure.kind === "forbidden" ? "No access" : "Unavailable"
          }
          badgeTone="setup"
          title={failure.title}
          description={failure.description}
        >
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page duties-page">
        <PageHeader navPath="/duties" title="Duties" />
        <OfflineBanner feature="Duties" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState soft title="Opening duties…" description="Loading on-duty and chaperone assignments." aria-busy />
      </main>
    );
  }

  if (view.status !== "ready") {
    return (
      <main className="module-page duties-page">
        <PageHeader navPath="/duties" title="Duties">
          <Button as="a" variant="secondary" href={withOrgHref("/my-day", view.orgId)}>
            My Day
          </Button>
        </PageHeader>
        <OfflineBanner feature="Duties" fromCache={fromCache} cachedAt={cachedAt} />
        {error ? (
          <p className="telemetry-status" role="alert">
            {error}
          </p>
        ) : null}
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title={view.message}
          description="Choose your team, then post who is on duty. My Day stays empty until someone is assigned."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  return (
    <ReadyDuties
      view={view}
      busy={busy}
      error={error}
      onAssign={mutate}
      fromCache={fromCache}
      cachedAt={cachedAt}
    />
  );
}

function ReadyDuties({
  view,
  busy,
  error,
  onAssign,
  fromCache,
  cachedAt,
}: {
  view: ReadyView;
  busy: boolean;
  error: string;
  onAssign: (payload: Record<string, unknown>) => void;
  fromCache: boolean;
  cachedAt: string | null;
}) {
  const orgQ = `?orgId=${encodeURIComponent(view.orgId)}`;
  const assigned = view.watches.filter((watch) => watch.assignedUserId);
  const open = view.watches.filter((watch) => !watch.assignedUserId);

  return (
    <main className="module-page duties-page">
      <PageHeader
        navPath="/duties"
        title="Duties"
        description="Who is on duty or chaperoning. My Day reads the assigned adult — nothing is shown there until you post someone."
      >
        <div className="duties-links">
          <Button as="a" variant="secondary" href={`/my-day${orgQ}`}>
            My Day
          </Button>
          <Button as="a" variant="secondary" href={`/logistics${orgQ}`}>
            Logistics
          </Button>
          <Button as="a" variant="secondary" href={`/team/calendar${orgQ}&tab=duties`}>
            Shift roster
          </Button>
        </div>
      </PageHeader>
      <OfflineBanner feature="Duties" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="duties-warn" role="alert">
          {error}
        </p>
      ) : null}

      <section className="soft-panel duties-now">
        <h2>Who is on</h2>
        {view.activeWatch ? (
          <p className="duties-active" role="status">
            <strong>
              {WATCH_KIND_LABELS[view.activeWatch.kind]} · {view.activeWatch.assignedUserName || "Teammate"}
            </strong>
            <span>
              {formatWhen(view.activeWatch.startsAt)}
              {view.activeWatch.phone ? ` · ${view.activeWatch.phone}` : ""}
              {view.activeWatch.locationNote ? ` · ${view.activeWatch.locationNote}` : ""}
            </span>
          </p>
        ) : (
          <EmptyState
            soft
            title="No one is posted yet"
            description="My Day stays empty until an owner or admin assigns an on-duty mentor or chaperone."
          />
        )}
      </section>

      {view.canManage ? (
        <AssignWatchForm
          members={view.members}
          busy={busy}
          onSubmit={(payload) => onAssign({ action: "assign_watch", ...payload })}
        />
      ) : null}

      <Panel>
        <h2>On-duty and chaperone</h2>
        {view.watches.length === 0 ? (
          <p className="app-muted">No on-duty or chaperone slots yet. Assign someone above when travel starts.</p>
        ) : (
          <ul className="duties-list">
            {assigned.map((watch) => (
              <WatchRow
                key={watch.id}
                watch={watch}
                canManage={view.canManage}
                busy={busy}
                onUnassign={() => onAssign({ action: "update_watch", id: watch.id, assignedUserId: null })}
                onDelete={() => onAssign({ action: "delete_watch", id: watch.id })}
              />
            ))}
            {open.map((watch) => (
              <WatchRow
                key={watch.id}
                watch={watch}
                canManage={view.canManage}
                busy={busy}
                onUnassign={() => undefined}
                onDelete={() => onAssign({ action: "delete_watch", id: watch.id })}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <h2>Other upcoming slots</h2>
        {view.roster.length === 0 ? (
          <p className="app-muted">Scouting, pit, drive-team, and outreach slots are assigned on Team Calendar.</p>
        ) : (
          <ul className="duties-list">
            {view.roster.map((slot) => (
              <RosterRow key={slot.id} slot={slot} calendarHref={`/team/calendar${orgQ}&tab=duties`} />
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}

function AssignWatchForm({
  members,
  busy,
  onSubmit,
}: {
  members: ReadyView["members"];
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [kind, setKind] = useState<WatchKind>("on_duty");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [phone, setPhone] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Panel>
      <h2>Assign who is on</h2>
      <form
        className="duties-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!assignedUserId || !startsAt) return;
          onSubmit({
            kind,
            assignedUserId,
            startsAt: new Date(startsAt).toISOString(),
            endsAt: endsAt ? new Date(endsAt).toISOString() : null,
            phone,
            locationNote,
            notes,
          });
          setAssignedUserId("");
          setPhone("");
          setLocationNote("");
          setNotes("");
        }}
      >
        <FormGrid min={160}>
          <SelectField
            label="Kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as WatchKind)}
            options={[
              { value: "on_duty", label: WATCH_KIND_LABELS.on_duty },
              { value: "chaperone", label: WATCH_KIND_LABELS.chaperone },
            ]}
          />
          <SelectField
            label="Teammate"
            required
            value={assignedUserId}
            onChange={(event) => setAssignedUserId(event.target.value)}
            placeholder="Pick who is on"
            options={members.map((member) => ({
              value: member.userId,
              label: memberLabel(member),
            }))}
          />
          <TextField
            label="Starts"
            type="datetime-local"
            required
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
          <TextField
            label="Ends"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
          <TextField
            label="Phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="Optional contact"
          />
          <TextField
            label="Where"
            value={locationNote}
            onChange={(event) => setLocationNote(event.target.value)}
            placeholder="Pit, hotel lobby…"
          />
        </FormGrid>
        <TextareaField
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <Button variant="primary" type="submit" disabled={busy || !assignedUserId || !startsAt}>
          {busy ? "Saving…" : "Post assignment"}
        </Button>
      </form>
    </Panel>
  );
}

function WatchRow({
  watch,
  canManage,
  busy,
  onUnassign,
  onDelete,
}: {
  watch: DutyWatch;
  canManage: boolean;
  busy: boolean;
  onUnassign: () => void;
  onDelete: () => void;
}) {
  return (
    <li>
      <strong>
        {watch.title || WATCH_KIND_LABELS[watch.kind]}
        {watch.mine ? " · yours" : ""}
      </strong>
      <span>
        {WATCH_KIND_LABELS[watch.kind]}
        {" · "}
        {formatWhen(watch.startsAt)}
        {watch.locationNote ? ` · ${watch.locationNote}` : ""}
      </span>
      {watch.assignedUserName ? (
        <span>
          {watch.assignedUserName}
          {watch.phone ? ` · ${watch.phone}` : ""}
        </span>
      ) : (
        <span>Unassigned — My Day will not show this slot</span>
      )}
      {canManage ? (
        <div className="duties-row-actions">
          {watch.assignedUserId ? (
            <Button variant="secondary" type="button" disabled={busy} onClick={onUnassign}>
              Clear assignment
            </Button>
          ) : null}
          <Button variant="secondary" type="button" disabled={busy} onClick={onDelete}>
            Remove
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function RosterRow({ slot, calendarHref }: { slot: DutyRosterSlot; calendarHref: string }) {
  return (
    <li>
      <strong>{slot.title}</strong>
      <span>
        {ROSTER_KIND_LABELS[slot.kind]}
        {slot.subteamName ? ` · ${slot.subteamName}` : ""}
        {" · "}
        {formatWhen(slot.startsAt)}
      </span>
      {slot.assignedUserName ? (
        <span>{slot.assignedUserName}</span>
      ) : (
        <a href={calendarHref}>Unassigned — assign on calendar</a>
      )}
    </li>
  );
}
