"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { reminderKindLabel, tierLabel } from "../../lib/sponsor-suite";
import type { SponsorSuiteView } from "../../lib/sponsor-suite/compute-sponsor-suite";
import type { SponsorSuiteDeckKind, SponsorSuiteReminderKind } from "../../lib/sponsor-suite/types";

const DECK_KINDS: SponsorSuiteDeckKind[] = ["pitch", "renewal"];
const REMINDER_KINDS: SponsorSuiteReminderKind[] = ["thank_you", "renewal"];

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<SponsorSuiteView, { status: "live" }>;

export default function SponsorSuiteClient() {
  const [view, setView] = useState<SponsorSuiteView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/sponsor-suite${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SponsorSuiteView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
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
        const response = await fetch("/api/sponsor-suite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as SponsorSuiteView | { error?: string };
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business"}>Business</a>
            {" / Sponsor Suite"}
          </>
        }
        title="Sponsor Suite"
        description="Generate pitch/renewal decks, an end-of-season ROI report, and thank-you/renewal reminders — grounded in your recorded sponsors and contributions."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
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
          {orgId ? (
            <a className="app-button secondary" href={`/business?orgId=${encodeURIComponent(orgId)}&tab=sponsors`}>
              Business · Sponsors
            </a>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Sponsor Suite"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
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
          <GoalPanel view={view} busy={busy} mutate={mutate} />
          <RemindersPanel view={view} busy={busy} mutate={mutate} />
          <DeckPanel view={view} busy={busy} mutate={mutate} />
          <RoiPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function GoalPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const { goal } = view;
  const [draftGoal, setDraftGoal] = useState("");
  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Fundraising goal — {view.seasonYear}</h2>
          <small className="app-muted">Actual is computed live from recorded sponsor contributions.</small>
        </div>
        <strong style={{ fontSize: "1.6rem" }}>
          {goal.goalUsd != null ? pct(goal.attainmentPct ?? 0) : "No goal set"}
        </strong>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 12 }}>
        <div>
          <strong style={{ fontSize: "1.4rem", display: "block" }}>${goal.actualUsd.toLocaleString()}</strong>
          <span className="app-muted">Raised</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.4rem", display: "block" }}>
            {goal.goalUsd != null ? `$${goal.goalUsd.toLocaleString()}` : "—"}
          </strong>
          <span className="app-muted">Goal</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.4rem", display: "block" }}>
            {goal.remainingUsd != null ? `$${goal.remainingUsd.toLocaleString()}` : "—"}
          </strong>
          <span className="app-muted">Remaining</span>
        </div>
      </div>
      {goal.goalUsd != null ? (
        <span className="mini-probability" aria-hidden="true" style={{ display: "block", marginTop: 10 }}>
          <i style={{ width: `${Math.min(100, Math.max(2, (goal.attainmentPct ?? 0) * 100))}%` }} />
        </span>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(draftGoal);
          if (!Number.isFinite(value) || value < 0) return;
          mutate({ action: "set-goal", goalUsd: value });
          setDraftGoal("");
        }}
        style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}
      >
        <FormRow label={`Set ${view.seasonYear} goal ($)`}>
          <input
            type="number"
            min={0}
            value={draftGoal}
            onChange={(event) => setDraftGoal(event.target.value)}
            placeholder={goal.goalUsd != null ? String(goal.goalUsd) : "5000"}
          />
        </FormRow>
        <button type="submit" className="app-button secondary" disabled={busy || !draftGoal}>
          Save goal
        </button>
      </form>
    </Panel>
  );
}

function RemindersPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [sponsorId, setSponsorId] = useState("");
  const [kind, setKind] = useState<SponsorSuiteReminderKind>("thank_you");
  const [dueOn, setDueOn] = useState("");

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Thank-you / renewal reminders</h2>
      {view.reminders.length === 0 ? (
        <p className="app-muted">No pending reminders. Create one below for a sponsor.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {view.reminders.map((reminder) => (
            <li key={reminder.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong>{reminder.sponsorName}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {reminderKindLabel(reminder.kind)} · due {reminder.dueOn}
                  {reminder.note ? ` · ${reminder.note}` : ""}
                </small>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "resolve-reminder", reminderId: reminder.id, status: "sent" })}
                >
                  Mark sent
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "resolve-reminder", reminderId: reminder.id, status: "dismissed" })}
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {view.sponsors.length === 0 ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          Add sponsors in Business · Sponsors before creating reminders.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!sponsorId || !dueOn) return;
            mutate({ action: "create-reminder", sponsorId, kind, dueOn });
            setDueOn("");
          }}
          style={{ marginTop: 12 }}
        >
          <FormGrid min={140}>
            <FormRow label="Sponsor">
              <select value={sponsorId} onChange={(event) => setSponsorId(event.target.value)}>
                <option value="">Select…</option>
                {view.sponsors.map((sponsor) => (
                  <option key={sponsor.id} value={sponsor.id}>
                    {sponsor.name}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Kind">
              <select value={kind} onChange={(event) => setKind(event.target.value as SponsorSuiteReminderKind)}>
                {REMINDER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {reminderKindLabel(k)}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Due">
              <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
            </FormRow>
          </FormGrid>
          <button type="submit" className="app-button secondary" disabled={busy || !sponsorId || !dueOn} style={{ marginTop: 8 }}>
            Add reminder
          </button>
        </form>
      )}
    </Panel>
  );
}

function DeckPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [sponsorId, setSponsorId] = useState("");
  const [kind, setKind] = useState<SponsorSuiteDeckKind>("pitch");

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Pitch / renewal decks</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutate({ action: "generate-deck", sponsorId: sponsorId || undefined, kind });
        }}
        style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
      >
        <FormRow label="Sponsor (optional)">
          <select value={sponsorId} onChange={(event) => setSponsorId(event.target.value)}>
            <option value="">General prospect</option>
            {view.sponsors.map((sponsor) => (
              <option key={sponsor.id} value={sponsor.id}>
                {sponsor.name} ({tierLabel(sponsor.tier)})
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Kind">
          <select value={kind} onChange={(event) => setKind(event.target.value as SponsorSuiteDeckKind)}>
            {DECK_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === "pitch" ? "Pitch" : "Renewal"}
              </option>
            ))}
          </select>
        </FormRow>
        <button type="submit" className="app-button" disabled={busy}>
          Generate deck
        </button>
      </form>

      {view.decks.length === 0 ? (
        <EmptyState
          badge="No decks yet"
          badgeTone="setup"
          title="Generate your first sponsor deck"
          description="Pitch and renewal outlines are grounded in your recorded sponsor history and season goal."
        />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14, marginTop: 12 }}>
          {view.decks.map((deck) => (
            <li key={deck.id} className="app-card soft-panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <strong>{deck.title}</strong>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete "${deck.title}"?`)) {
                      mutate({ action: "delete-deck", deckId: deck.id });
                    }
                  }}
                >
                  Delete
                </button>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {deck.sections.map((section) => (
                  <div key={section.heading}>
                    <strong className="app-muted">{section.heading}</strong>
                    <p style={{ margin: "2px 0 0" }}>{section.body}</p>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RoiPanel({
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
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>End-of-season ROI report — {view.seasonYear}</h2>
        <button type="button" className="app-button secondary" disabled={busy} onClick={() => mutate({ action: "generate-roi-report" })}>
          Generate report
        </button>
      </header>

      {view.roiReports.length === 0 ? (
        <EmptyState
          badge="No reports yet"
          badgeTone="setup"
          title="Generate an ROI report"
          description="Summarizes recorded sponsor_contributions for this season against your fundraising goal."
        />
      ) : (
        <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
          {view.roiReports.map((report) => (
            <div key={report.id} className="app-card soft-panel" style={{ padding: 12 }}>
              <p style={{ margin: 0 }}>{report.narrative}</p>
              <ul className="factor-table" style={{ listStyle: "none", padding: 0, marginTop: 10, display: "grid", gap: 6 }}>
                {report.lines.map((line) => (
                  <li key={line.sponsorId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>
                      {line.sponsorName} <small className="app-muted">({tierLabel(line.tier)})</small>
                    </span>
                    <small className="app-muted">
                      ${line.totalContributedUsd.toLocaleString()} · {line.contributionCount} contribution(s)
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
