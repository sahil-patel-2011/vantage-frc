"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import {
  EXIT_INTERVIEW_ROLES,
  EXIT_INTERVIEW_STATUSES,
  type ExitInterviewView,
} from "../../lib/exit-interview/compute-exit-interview";
import { exitInterviewRoleLabel, exitInterviewStatusLabel, exitInterviewWikiHref } from "../../lib/exit-interview";
import type { ExitInterviewRole, ExitInterviewStatus } from "../../lib/exit-interview/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<ExitInterviewView, { status: "live" }>;

function isExitInterviewView(value: unknown): value is ExitInterviewView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function exitInterviewCacheOrg(data: ExitInterviewView, orgHint: string): string {
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

async function persistExitInterviewSnapshot(
  orgHint: string,
  seasonHint: string,
  data: ExitInterviewView,
): Promise<void> {
  const cacheOrg = exitInterviewCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("exit-interview", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("exit-interview", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Exit Interviews already painted; IndexedDB is best-effort.
  }
}

function ExitInterviewRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related people tools">
      <Button as="a" variant="secondary" href={hubHref("/team", "alumni-network", orgId)}>
        Alumni Network
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "mentor-hours", orgId)}>
        Mentor hours
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "roadmap", orgId)}>
        Season roadmap
      </Button>
    </nav>
  );
}

function ExitInterviewNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "capture",
      label: "Capture an exit interview",
      detail: "Submitted interviews write a season-handoff wiki page.",
      href: "#exit-interview-log",
      primary: true,
    },
    {
      id: "alumni",
      label: "Open Alumni Network",
      detail: "Keep graduates reachable after the handoff page is published.",
      href: hubHref("/team", "alumni-network", orgId),
      primary: false,
    },
    {
      id: "roadmap",
      label: "Open Season roadmap",
      detail: "The next season's kickoff-to-event list lives here.",
      href: hubHref("/team", "roadmap", orgId),
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

export default function ExitInterviewClient() {
  const [view, setView] = useState<ExitInterviewView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureMessage, setFailureMessage] = useState("");
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ExitInterviewView | null>(null);
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
      const cached = await getFeatureSnapshot<ExitInterviewView>(
        "exit-interview",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isExitInterviewView(cached.data)) {
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
    setFailureMessage("");
    setFailureStatus(null);
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/exit-interview${query.toString() ? `?${query.toString()}` : ""}`, {
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
      if (!response.ok || !isExitInterviewView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Exit Interviews. Showing the last copy on this device.");
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
      await persistExitInterviewSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Exit Interviews. Showing the last copy on this device.");
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
        const response = await fetch("/api/exit-interview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isExitInterviewView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistExitInterviewSnapshot(orgId, String(data.seasonYear), data);
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
          {" / Exit Interviews"}
        </>
      }
      title="Graduation Exit Interviews"
      description="Capture structured off-boarding prompts. Submitted interviews write a season-handoff wiki page."
    >
      <ExitInterviewRelated orgId={orgId} />
      {view?.status === "live" && view.seasons.length > 0 ? (
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
        <OfflineBanner feature="Exit Interviews" fromCache={fromCache} cachedAt={cachedAt} />
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
          <OfflineBanner feature="Exit Interviews" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
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
      <OfflineBanner feature="Exit Interviews" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <ExitInterviewNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        <LogResponseForm busy={busy} mutate={mutate} />
        {view.summary.totalRecords > 0 ? <Breakdowns view={view} /> : null}
        <RecentResponses view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Responses", value: String(summary.totalRecords) },
    { label: "Submitted", value: String(summary.submittedCount) },
    { label: "Drafts", value: String(summary.draftCount) },
    { label: "Willing to mentor", value: String(summary.mentorshipWillingCount) },
    { label: "Wiki pages", value: String(summary.wikiPageCount) },
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
        <h2 style={{ marginTop: 0 }}>By role</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byRole.map((row) => (
            <li key={row.role} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{exitInterviewRoleLabel(row.role)}</span>
              <small className="app-muted">{row.count}</small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By graduation year</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byGradYear.map((row) => (
            <li key={row.graduationYear} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{row.graduationYear}</span>
              <small className="app-muted">{row.count}</small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RecentResponses({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalRecords === 0) {
    return (
      <EmptyState
        badge="No responses yet"
        badgeTone="setup"
        title="Capture your first graduation exit interview"
        description="Highlights, advice, and skills worth documenting build the alumni knowledge base for future seasons."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Responses</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.records.map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.memberName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                Class of {item.graduationYear} · {exitInterviewRoleLabel(item.role)} · {item.yearsOnTeam} yr(s) ·{" "}
                {exitInterviewStatusLabel(item.status)}
                {item.willingToMentor ? " · Willing to mentor" : ""}
              </small>
              {item.highlights ? <p style={{ margin: "4px 0 0" }}>{item.highlights}</p> : null}
              {item.adviceForFuture ? (
                <small className="app-muted" style={{ display: "block" }}>
                  Advice: {item.adviceForFuture}
                </small>
              ) : null}
              {item.skillsToDocument ? (
                <small className="app-muted" style={{ display: "block" }}>
                  Skills to document: {item.skillsToDocument}
                </small>
              ) : null}
              {item.knowledgePageId ? (
                <a href={exitInterviewWikiHref(view.orgId, item.knowledgePageId)}>Open wiki handoff</a>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {item.status === "draft" ? (
                <Button variant="secondary" type="button" disabled={busy} onClick={() => { if ( window.confirm( `Submit "${item.memberName}"'s exit interview? This publishes the handoff page to the team wiki and cannot be moved back to a draft.`, ) ) { mutate({ action: "submit-response", recordId: item.id }); } }}>
                  Submit &amp; publish
                </Button>
              ) : null}
              {view.canManage ? (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete "${item.memberName}"'s exit interview?`)) {
                      mutate({ action: "delete-response", recordId: item.id });
                    }
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogResponseForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      memberName: "",
      role: "other" as ExitInterviewRole,
      status: "submitted" as ExitInterviewStatus,
      yearsOnTeam: "",
      graduationYear: "",
      highlights: "",
      adviceForFuture: "",
      skillsToDocument: "",
      contactEmail: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const [willingToMentor, setWillingToMentor] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      id="exit-interview-log"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.memberName.trim() || !form.graduationYear) return;
        mutate({
          action: "log-response",
          memberName: form.memberName,
          role: form.role,
          status: form.status,
          yearsOnTeam: Number(form.yearsOnTeam) || 0,
          graduationYear: Number(form.graduationYear),
          highlights: form.highlights || undefined,
          adviceForFuture: form.adviceForFuture || undefined,
          skillsToDocument: form.skillsToDocument || undefined,
          willingToMentor,
          contactEmail: form.contactEmail || undefined,
        });
        setForm(empty);
        setWillingToMentor(false);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Capture exit interview</h2>
      <FormGrid min={160}>
        <FormRow label="Member name">
          <input value={form.memberName} onChange={set("memberName")} placeholder="Jane Doe" required />
        </FormRow>
        <FormRow label="Graduation year">
          <input
            type="number"
            min={2000}
            max={2999}
            value={form.graduationYear}
            onChange={set("graduationYear")}
            required
          />
        </FormRow>
        <FormRow label="Primary role">
          <select value={form.role} onChange={set("role")}>
            {EXIT_INTERVIEW_ROLES.map((role) => (
              <option key={role} value={role}>
                {exitInterviewRoleLabel(role)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Years on team">
          <input type="number" min={0} value={form.yearsOnTeam} onChange={set("yearsOnTeam")} />
        </FormRow>
        <FormRow label="Status">
          <select value={form.status} onChange={set("status")}>
            {EXIT_INTERVIEW_STATUSES.map((status) => (
              <option key={status} value={status}>
                {exitInterviewStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Contact email (optional)">
          <input type="email" value={form.contactEmail} onChange={set("contactEmail")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Highlights (optional)">
        <textarea value={form.highlights} onChange={set("highlights")} rows={2} />
      </FormRow>
      <FormRow label="Advice for future members (optional)">
        <textarea value={form.adviceForFuture} onChange={set("adviceForFuture")} rows={2} />
      </FormRow>
      <FormRow label="Skills worth documenting (optional)">
        <textarea value={form.skillsToDocument} onChange={set("skillsToDocument")} rows={2} />
      </FormRow>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={willingToMentor}
          onChange={(event) => setWillingToMentor(event.target.checked)}
        />
        Willing to mentor future members
      </label>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.memberName.trim() || !form.graduationYear}>
          Save exit interview
        </Button>
      </div>
    </Panel>
  );
}
