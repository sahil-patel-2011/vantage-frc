"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { mentorHoursCategoryLabel, mentorHoursRoleLabel } from "../../lib/mentor-hours";
import {
  MENTOR_HOURS_CATEGORIES,
  MENTOR_HOURS_ROLES,
  type MentorHoursView,
} from "../../lib/mentor-hours/compute-mentor-hours";
import type { MentorHoursCategory, MentorHoursRole, MentorHoursTier } from "../../lib/mentor-hours/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

const COMPONENT_LABEL: Record<string, string> = {
  volume: "Hours volume",
  cadence: "Season cadence",
  mentorBreadth: "Mentor bench",
  roleBreadth: "Role diversity",
};

function tierTone(tier: MentorHoursTier): string {
  if (tier === "strong") return "good";
  if (tier === "developing") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<MentorHoursView, { status: "live" }>;

function isMentorHoursView(value: unknown): value is MentorHoursView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "empty" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function mentorHoursCacheOrg(data: MentorHoursView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "empty":
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistMentorHoursSnapshot(
  orgHint: string,
  seasonHint: string,
  data: MentorHoursView,
): Promise<void> {
  const cacheOrg = mentorHoursCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("mentor-hours", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("mentor-hours", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Mentor hours already painted; IndexedDB is best-effort.
  }
}

function MentorHoursRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related people tools">
      <Button as="a" variant="secondary" href={hubHref("/team", "hours-self-view", orgId)}>
        My hours
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "alumni-network", orgId)}>
        Alumni
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "exit-interview", orgId)}>
        Exit interviews
      </Button>
    </nav>
  );
}

function MentorHoursNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "log",
      label: "Log mentor hours",
      detail: "Adult volunteer time is the evidence trail for grant reporting.",
      href: "#mentor-hours-log",
      primary: true,
    },
    {
      id: "my-hours",
      label: "Open My hours",
      detail: "Student shop hours stay on a separate clock.",
      href: hubHref("/team", "hours-self-view", orgId),
      primary: false,
    },
    {
      id: "alumni",
      label: "Open Alumni",
      detail: "Alumni mentors who offered office hours live there.",
      href: hubHref("/team", "alumni-network", orgId),
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

export default function MentorHoursClient() {
  const [view, setView] = useState<MentorHoursView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<MentorHoursView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const seasonHint =
      seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<MentorHoursView>("mentor-hours", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isMentorHoursView(cached.data)) {
        setView(cached.data);
        setSeason(cached.data.seasonYear);
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
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/mentor-hours${query.toString() ? `?${query.toString()}` : ""}`, {
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
      if (!response.ok || !isMentorHoursView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Mentor hours. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistMentorHoursSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Mentor hours. Showing the last copy on this device.");
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
        const response = await fetch("/api/mentor-hours", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isMentorHoursView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistMentorHoursSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const teamHref = orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={teamHref}>Team</a>
          {" / Mentor hours"}
        </>
      }
      title="Mentor hours"
      description="Log mentor time by role and activity — the evidence trail for grant reporting. Engagement readiness uses only what you record."
    >
      <MentorHoursRelated orgId={orgId} />
      {(view?.status === "live" || view?.status === "empty") && view.seasons.length > 0 ? (
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Season
          <select
            value={season ?? view.seasonYear}
            onChange={(event) => {
              const next = Number(event.target.value);
              setSeason(next);
              void load(next);
            }}
          >
            {view.seasons.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      ) : null}
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
        <OfflineBanner feature="Mentor hours" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Opening Mentor hours"}
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
          <OfflineBanner feature="Mentor hours" fromCache={fromCache} cachedAt={cachedAt} />
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
    case "empty":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Mentor hours" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState
            badge="No entries yet"
            badgeTone="setup"
            title={view.message}
            description="Adult volunteer time is a separate ledger from student shop hours. Totals stay empty until a mentor or parent logs minutes here — student clock-ins never fill this in."
          >
            <Button as="a" variant="primary" href="#mentor-hours-log">
              Log hours
            </Button>
          </EmptyState>
          <LogEntryForm busy={busy} mutate={mutate} />
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
      <OfflineBanner feature="Mentor hours" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <MentorHoursNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <EngagementPanel view={view} />
        <SummaryTiles view={view} />
        <LogEntryForm busy={busy} mutate={mutate} />
        <Breakdowns view={view} />
        <RecentEntries view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function EngagementPanel({ view }: { view: LiveView }) {
  const { engagement } = view;
  const components = Object.entries(engagement.components) as Array<[string, number]>;
  return (
    <Panel aria-label="Mentor engagement readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${tierTone(engagement.tier)}`}>{engagement.tier.toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Grant-report engagement readiness</h2>
          <small className="app-muted">
            Active in {engagement.monthsActive} month(s) · {engagement.mentorsEngaged} mentor(s) engaged.
            Readiness uses a default yardstick of 200 mentor-hours over 6 months with 4 mentors — not a recorded
            team goal.
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(engagement.score)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {components.map(([key, value]) => (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "160px 1fr 48px", gap: 8, alignItems: "center" }}>
            <span className="app-muted">{COMPONENT_LABEL[key] ?? key}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, value * 100)}%` }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>{pct(value)}</small>
          </div>
        ))}
      </div>
      {engagement.recommendations.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Next steps</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {engagement.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Entries", value: String(summary.totalEntries) },
    { label: "Hours", value: String(summary.totalHours) },
    { label: "Mentors engaged", value: String(summary.uniqueMentors) },
    { label: "Engagement signal", value: pct(summary.engagementSignal) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Breakdowns({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}
    >
      <div>
        <h2 style={{ marginTop: 0 }}>By category</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byCategory.map((row) => (
            <li key={row.category} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{mentorHoursCategoryLabel(row.category)}</span>
              <small className="app-muted">
                {row.entries} · {row.hours}h
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By role</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byRole.map((row) => (
            <li key={row.role} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{mentorHoursRoleLabel(row.role)}</span>
              <small className="app-muted">
                {row.entries} · {row.hours}h
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By mentor</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byMentor.slice(0, 10).map((row) => (
            <li key={row.mentorName} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{row.mentorName}</span>
              <small className="app-muted">
                {row.entries} · {row.hours}h
              </small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RecentEntries({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalEntries === 0) {
    return (
      <EmptyState
        badge="No entries yet"
        badgeTone="setup"
        title="Log your first mentor-hours entry"
        description="Build sessions, strategy meetings, and outreach support all count toward grant-ready mentor engagement records."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent entries</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.entries.slice(0, 20).map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.mentorName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.occurredOn} · {mentorHoursRoleLabel(item.role)} · {mentorHoursCategoryLabel(item.category)}
              </small>
              <small className="app-muted">
                {Math.round(item.durationMinutes / 6) / 10}h
                {item.notes ? ` · ${item.notes}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete entry for "${item.mentorName}"?`)) {
                  mutate({ action: "delete-entry", entryId: item.id });
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogEntryForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      mentorName: "",
      occurredOn: "",
      role: "mentor" as MentorHoursRole,
      category: "build" as MentorHoursCategory,
      durationMinutes: "",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      id="mentor-hours-log"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.mentorName.trim() || !form.occurredOn || Number(form.durationMinutes) <= 0) return;
        mutate({
          action: "log-entry",
          mentorName: form.mentorName,
          occurredOn: form.occurredOn,
          role: form.role,
          category: form.category,
          durationMinutes: Number(form.durationMinutes),
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log mentor hours</h2>
      <FormGrid min={160}>
        <FormRow label="Mentor name">
          <input value={form.mentorName} onChange={set("mentorName")} placeholder="Pat Mentor" required />
        </FormRow>
        <FormRow label="Date">
          <input type="date" value={form.occurredOn} onChange={set("occurredOn")} required />
        </FormRow>
        <FormRow label="Role">
          <select value={form.role} onChange={set("role")}>
            {MENTOR_HOURS_ROLES.map((role) => (
              <option key={role} value={role}>
                {mentorHoursRoleLabel(role)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Activity">
          <select value={form.category} onChange={set("category")}>
            {MENTOR_HOURS_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {mentorHoursCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Duration (min)">
          <input type="number" min={1} step={1} value={form.durationMinutes} onChange={set("durationMinutes")} required />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.mentorName.trim() || !form.occurredOn || Number(form.durationMinutes) <= 0}>
          Log hours
        </Button>
      </div>
    </Panel>
  );
}

