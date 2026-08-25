"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { exitInterviewRoleLabel, exitInterviewStatusLabel, exitInterviewWikiHref } from "../../lib/exit-interview";
import {
  EXIT_INTERVIEW_ROLES,
  EXIT_INTERVIEW_STATUSES,
  type ExitInterviewView,
} from "../../lib/exit-interview/compute-exit-interview";
import type { ExitInterviewRole, ExitInterviewStatus } from "../../lib/exit-interview/types";

type LiveView = Extract<ExitInterviewView, { status: "live" }>;

export default function ExitInterviewClient() {
  const [view, setView] = useState<ExitInterviewView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/exit-interview${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ExitInterviewView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
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
        const response = await fetch("/api/exit-interview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ExitInterviewView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  // Retry cannot fix an expired session, so the failure decides its own action.
  const failure = fetchFailed
    ? loadFailureCopy(
        classifyLoadFailure({
          status: errorStatus,
          message: loadError,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
        }),
        {
          nextPath:
            typeof window === "undefined"
              ? null
              : `${window.location.pathname}${window.location.search}`,
          message: loadError || "A network or server issue prevented loading. Try again.",
        },
      )
    : null;

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Exit Interviews"}
          </>
        }
        title="Graduation Exit Interviews"
        description="Capture structured off-boarding prompts. Submitted interviews write a season-handoff wiki page."
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load(next);
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

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState title={failure.title} description={failure.description}>
          {failure.primary ? (
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
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
          <LogResponseForm busy={busy} mutate={mutate} />
          {view.summary.totalRecords > 0 ? <Breakdowns view={view} /> : null}
          <RecentResponses view={view} busy={busy} mutate={mutate} />
        </div>
      )}
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
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.memberName.trim() || !form.graduationYear}
        >
          Save exit interview
        </button>
      </div>
    </Panel>
  );
}
