"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/app-shell";
import { PageHeader } from "../../components/ui";
import { countdownLabel } from "../dashboard/widgets";
import type { CommandSnapshot } from "../../lib/command/types";

type Me = {
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
};

type EventOption = {
  eventKey: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  stateProv: string | null;
  year: number;
};

const POLL_MS = 20_000;

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function teamLabel(teamKey: string, teamNumber?: number | null) {
  if (teamNumber) return String(teamNumber);
  const m = /^frc(\d+)$/i.exec(teamKey);
  return m ? m[1] : teamKey;
}

function AllianceChips({
  keys,
  ours,
  highlight,
}: {
  keys: string[];
  ours: string | null;
  highlight?: "red" | "blue";
}) {
  return (
    <ul className="edc-alliance">
      {keys.map((key) => (
        <li key={key} className={key === ours ? "us" : highlight ?? ""}>
          {teamLabel(key)}
        </li>
      ))}
    </ul>
  );
}

export default function CommandClient() {
  const [me, setMe] = useState<Me>({});
  const [orgId, setOrgId] = useState("");
  const [snap, setSnap] = useState<CommandSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventQ, setEventQ] = useState("");
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventMessage, setEventMessage] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("orgId") ?? "";
    void fetch("/api/me")
      .then(async (r) => (r.ok ? ((await r.json()) as Me) : null))
      .then((data) => {
        if (!data) return;
        setMe(data);
        setOrgId(fromUrl || data.orgId || "");
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) {
      setLoading(false);
      setSnap(null);
      return;
    }
    const response = await fetch(`/api/command?orgId=${encodeURIComponent(id)}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Could not load Event Day Command");
      setLoading(false);
      return;
    }
    const data = (await response.json()) as CommandSnapshot;
    setSnap(data);
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    void load(orgId);
    const poll = window.setInterval(() => void load(orgId), POLL_MS);
    return () => window.clearInterval(poll);
  }, [orgId, load]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const loadEvents = useCallback(
    async (q: string) => {
      if (!orgId) return;
      const year = new Date().getFullYear();
      const params = new URLSearchParams({ orgId, year: String(year), q });
      const response = await fetch(`/api/context/event?${params}`);
      if (!response.ok) return;
      const data = await response.json();
      setEvents(data.events ?? []);
    },
    [orgId],
  );

  useEffect(() => {
    if (!eventOpen) return;
    const handle = window.setTimeout(() => void loadEvents(eventQ), 200);
    return () => window.clearTimeout(handle);
  }, [eventOpen, eventQ, loadEvents]);

  async function setActiveEvent(eventKey: string | null) {
    if (!orgId) return;
    setEventBusy(true);
    setEventMessage("");
    try {
      const response = await fetch("/api/context/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, eventKey }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setEventMessage(body.error ?? "Could not set event");
        return;
      }
      setEventOpen(false);
      setEventMessage(eventKey ? `Active event set to ${body.eventName ?? eventKey}` : "Active event cleared");
      await load(orgId);
    } finally {
      setEventBusy(false);
    }
  }

  const next = snap?.matches[0] ?? null;
  const after = snap?.matches[1] ?? null;
  const countdown = useMemo(() => countdownLabel(next?.scheduledTime), [next?.scheduledTime, tick]);

  if (!orgId && !loading) {
    return (
      <main className="edc-page">
        <PageHeader
          breadcrumbs="Competition / Event Day"
          title="Select a team workspace"
          description="Open Home to choose your organization, then return here for the field-side command center."
        >
          <a className="app-button" href="/dashboard">
            Go to Home
          </a>
        </PageHeader>
      </main>
    );
  }

  return (
    <main className="edc-page">
      <PageHeader
        breadcrumbs="Competition / Event Day"
        title={snap?.eventName ?? "Event Day Command"}
        description={
          <>
            {snap?.orgName ? `${snap.orgName}` : me.orgName ?? "Your team"}
            {snap?.teamNumber ? ` · Team ${snap.teamNumber}` : ""}
            {snap?.eventKey ? ` · ${snap.eventKey}` : ""}
            {" — "}
            Next match, scout gaps, and labeled model briefs. No demo data.
          </>
        }
      >
        <div className="edc-header-actions">
          <span className="edc-live" aria-live="polite">
            {loading && !snap ? "Loading…" : `Updated ${snap ? new Date(snap.computedAt).toLocaleTimeString() : "—"}`}
          </span>
          {snap?.canSetEvent ? (
            <button className="app-button secondary" type="button" onClick={() => setEventOpen(true)}>
              {snap.eventKey ? "Change event" : "Select event"}
            </button>
          ) : null}
          <button className="app-button secondary" type="button" onClick={() => void load(orgId)} disabled={!orgId}>
            Refresh
          </button>
        </div>
      </PageHeader>

      {error ? <p className="edc-banner error">{error}</p> : null}
      {eventMessage ? <p className="edc-banner ok">{eventMessage}</p> : null}

      {snap?.status === "setup_required" || (!snap?.eventKey && snap) ? (
        <section className="edc-setup dash-setup-banner" aria-label="Setup required">
          <div>
            <span className="edc-kicker">Setup</span>
            <h2>{snap.message ?? "Finish setup to go live"}</h2>
            <p>No demo data — Event Day Command only shows TBA-synced schedule, your scout coverage, and labeled model briefs.</p>
          </div>
          <ol className="dash-setup-steps">
            {snap.setupSteps.map((step, index) => (
              <li key={step.id} className={step.done ? "done" : index === snap.setupSteps.findIndex((s) => !s.done) ? "current" : ""}>
                <b>{step.done ? "✓" : index + 1}</b>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                {step.id === "event" && snap.canSetEvent ? (
                  <button type="button" onClick={() => setEventOpen(true)}>
                    Select
                  </button>
                ) : step.done ? (
                  <em>Done</em>
                ) : (
                  <a href={step.href}>Open</a>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="edc-priority" aria-label="Priority panels">
        <article className={`edc-card edc-next ${next ? "live" : "empty"}`}>
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#1f4fd6", ["--tone-bg" as string]: "#e4ecfc" }}>
                <Icon name="swords" />
              </span>
              <div>
                <h2>Now / Next</h2>
                <p>{next ? "Your upcoming match from TBA cache" : "Waiting for schedule"}</p>
              </div>
            </div>
            {next ? <span className="edc-pill">{countdown}</span> : null}
          </header>
          {next ? (
            <>
              <div className="edc-match-hero">
                <strong>
                  {next.compLevel.toUpperCase()} {next.matchNumber}
                </strong>
                <span>{next.ourAlliance ? `You are ${next.ourAlliance.toUpperCase()}` : "Alliance TBD"}</span>
              </div>
              <div className="edc-alliances">
                <div>
                  <span>Red</span>
                  <AllianceChips keys={next.red.teamKeys} ours={snap?.teamKey ?? null} highlight="red" />
                </div>
                <div>
                  <span>Blue</span>
                  <AllianceChips keys={next.blue.teamKeys} ours={snap?.teamKey ?? null} highlight="blue" />
                </div>
              </div>
              {after ? (
                <footer className="edc-after">
                  After · {after.compLevel.toUpperCase()} {after.matchNumber}
                  {after.scheduledTime ? ` · ${countdownLabel(after.scheduledTime)}` : ""}
                </footer>
              ) : null}
            </>
          ) : (
            <div className="dash-empty">
              <strong>No upcoming match</strong>
              <p>{snap?.message ?? "Sync TBA and select your event to load the queue."}</p>
              <a className="dash-empty-cta" href={snap?.links.teamData ?? "/team/data"}>
                Open TBA sync
              </a>
            </div>
          )}
        </article>

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#15803d", ["--tone-bg" as string]: "#dcfce7" }}>
                <Icon name="clipboard" />
              </span>
              <div>
                <h2>Scout next</h2>
                <p>
                  {snap
                    ? `${snap.coverage.upcomingUnscouted} gap${snap.coverage.upcomingUnscouted === 1 ? "" : "s"} in upcoming alliances`
                    : "Coverage queue"}
                </p>
              </div>
            </div>
          </header>
          {snap?.scoutQueue.length ? (
            <ul className="edc-queue">
              {snap.scoutQueue.map((item) => (
                <li key={`${item.teamKey}-${item.matchKey}`}>
                  <div>
                    <strong>{item.teamNumber ?? teamLabel(item.teamKey)}</strong>
                    <span>
                      {item.matchLabel ?? "Event"} · {item.reasons.slice(0, 2).join(" · ")}
                    </span>
                  </div>
                  <a href={item.formHref}>Scout</a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dash-empty calm">
              <strong>Queue clear</strong>
              <p>
                {snap?.eventKey
                  ? "Upcoming alliance partners and opponents already have coverage, or no matches are queued."
                  : "Select an event to build the scout queue from schedule gaps."}
              </p>
              <a className="dash-empty-cta" href={snap?.links.scouting ?? "/scouting"}>
                Open scouting
              </a>
            </div>
          )}
        </article>

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#1f4fd6", ["--tone-bg" as string]: "#e4ecfc" }}>
                <Icon name="bolt" />
              </span>
              <div>
                <h2>Matchup snapshot</h2>
                <p>
                  {snap?.prediction.modelVersion
                    ? `MODEL ${snap.prediction.modelVersion}`
                    : "Labeled win/loss when schedule + metrics exist"}
                </p>
              </div>
            </div>
          </header>
          {snap?.prediction.status === "live" && snap.prediction.pOur != null ? (
            <>
              <div className="edc-prob">
                <strong>{pct(snap.prediction.pOur)}</strong>
                <span>Our win probability</span>
              </div>
              <p className="edc-muted">
                Opp {pct(snap.prediction.pOpp)}
                {snap.prediction.confidenceLow != null && snap.prediction.confidenceHigh != null
                  ? ` · band ${pct(snap.prediction.confidenceLow)}–${pct(snap.prediction.confidenceHigh)}`
                  : ""}
              </p>
              <ul className="edc-factors">
                {snap.prediction.keyFactors.slice(0, 3).map((factor) => (
                  <li key={factor.name}>
                    <strong>{factor.name}</strong>
                    <span>{factor.evidence}</span>
                  </li>
                ))}
              </ul>
              {snap.prediction.caveats[0] ? <p className="edc-caveat">{snap.prediction.caveats[0]}</p> : null}
              <a className="edc-link" href={snap.links.strategy}>
                Open full strategy →
              </a>
            </>
          ) : (
            <div className="dash-empty calm">
              <strong>No prediction yet</strong>
              <p>Needs an upcoming match plus TBA/Statbotics metrics. Never shown as a TBA fact.</p>
              <a className="dash-empty-cta" href={snap?.links.strategy ?? "/strategy"}>
                Open strategy
              </a>
            </div>
          )}
        </article>
      </section>

      <section className="edc-secondary" aria-label="Briefs and flags">
        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#0f766e", ["--tone-bg" as string]: "#ccfbf1" }}>
                <Icon name="target" />
              </span>
              <div>
                <h2>Drive coach briefs</h2>
                <p>Opponent tendencies + scout capabilities (cited)</p>
              </div>
            </div>
          </header>
          {snap?.briefs.length ? (
            <ul className="edc-briefs">
              {snap.briefs.map((brief) => (
                <li key={brief.teamKey}>
                  <div className="edc-brief-head">
                    <strong>{brief.teamNumber ?? teamLabel(brief.teamKey)}</strong>
                    <div className="edc-tags">
                      {brief.labels.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                  </div>
                  {brief.capabilities.length ? (
                    <p className="edc-caps">{brief.capabilities.join(" · ")}</p>
                  ) : null}
                  <ul>
                    {brief.evidence.slice(0, 3).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dash-empty calm">
              <strong>No opponent briefs</strong>
              <p>Briefs appear once your next match is known and reference metrics or scout notes exist.</p>
            </div>
          )}
        </article>

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#b91c1c", ["--tone-bg" as string]: "#fee2e2" }}>
                <Icon name="bell" />
              </span>
              <div>
                <h2>Pit flags · this match</h2>
                <p>Mechanical / reliability signals that matter now</p>
              </div>
            </div>
          </header>
          {snap?.pitFlags.length ? (
            <ul className="edc-flags">
              {snap.pitFlags.map((flag) => (
                <li key={`${flag.teamKey}-${flag.title}`} data-severity={flag.severity}>
                  <strong>
                    {flag.teamNumber ?? teamLabel(flag.teamKey)} · {flag.title}
                  </strong>
                  <span>{flag.detail}</span>
                  <small>{flag.evidence}</small>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dash-empty calm">
              <strong>No pit flags</strong>
              <p>Pit and match scout reliability notes for the next alliance appear here when logged.</p>
            </div>
          )}
        </article>

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#1f4fd6", ["--tone-bg" as string]: "#e4ecfc" }}>
                <Icon name="stats" />
              </span>
              <div>
                <h2>Season pulse</h2>
                <p>Record & rank with source label</p>
              </div>
            </div>
          </header>
          {snap?.record.status === "live" ? (
            <div className="edc-pulse">
              <div>
                <strong>
                  {snap.record.wins ?? 0}-{snap.record.losses ?? 0}-{snap.record.ties ?? 0}
                </strong>
                <span>W-L-T</span>
              </div>
              <div>
                <strong>{snap.record.rank ?? "—"}</strong>
                <span>Rank</span>
              </div>
              <div>
                <strong>{snap.record.epaTotal != null ? Math.round(snap.record.epaTotal * 10) / 10 : "—"}</strong>
                <span>EPA</span>
              </div>
              <p className="edc-muted">
                Source: {snap.record.source ?? "reference"}
                {snap.record.syncedAt ? ` · synced ${new Date(snap.record.syncedAt).toLocaleString()}` : ""}
              </p>
              <p className="edc-muted">
                Scout coverage: {snap.coverage.matchReports} match · {snap.coverage.pitReports} pit
                {snap.coverage.openDisagreements ? ` · ${snap.coverage.openDisagreements} open disagreements` : ""}
              </p>
            </div>
          ) : (
            <div className="dash-empty calm">
              <strong>No event metrics yet</strong>
              <p>Rank and EPA appear after TBA/Statbotics sync for your team at this event.</p>
            </div>
          )}
        </article>
      </section>

      <nav className="edc-actions" aria-label="Primary competition links">
        <a href={snap?.links.strategy ?? "/strategy"}>
          <Icon name="bolt" />
          <strong>Strategy</strong>
          <span>Playbook & prediction</span>
        </a>
        <a href={snap?.links.scouting ?? "/scouting"}>
          <Icon name="clipboard" />
          <strong>Scouting</strong>
          <span>Match & pit forms</span>
        </a>
        <a href={snap?.links.intel ?? "/intel"}>
          <Icon name="stats" />
          <strong>Intel</strong>
          <span>Team lookup</span>
        </a>
        <a href={snap?.links.chemistry ?? (orgId ? `/chemistry?orgId=${encodeURIComponent(orgId)}` : "/chemistry")}>
          <Icon name="users" />
          <strong>Chemistry</strong>
          <span>Alliance fit</span>
        </a>
      </nav>

      {eventOpen ? (
        <div className="edc-modal" role="dialog" aria-modal="true" aria-labelledby="edc-event-title">
          <div>
            <header>
              <h2 id="edc-event-title">Select active event</h2>
              <button type="button" aria-label="Close" onClick={() => setEventOpen(false)}>
                ×
              </button>
            </header>
            <p className="edc-muted">Only owners and admins can set the event. Lists come from the TBA reference cache — empty means sync first.</p>
            <input
              className="edc-search"
              value={eventQ}
              onChange={(e) => setEventQ(e.target.value)}
              placeholder="Search event name, key, or city"
              aria-label="Search events"
            />
            <ul className="edc-event-list">
              {events.length ? (
                events.map((event) => (
                  <li key={event.eventKey}>
                    <button type="button" disabled={eventBusy} onClick={() => void setActiveEvent(event.eventKey)}>
                      <strong>{event.name}</strong>
                      <span>
                        {event.eventKey}
                        {event.city ? ` · ${event.city}` : ""}
                        {event.stateProv ? `, ${event.stateProv}` : ""}
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="edc-empty-events">
                  No events in cache for this year.{" "}
                  <a href={snap?.links.teamData ?? withOrgFallback(orgId)}>Open Team → Data to sync TBA</a>
                </li>
              )}
            </ul>
            {snap?.eventKey ? (
              <button className="app-button secondary" type="button" disabled={eventBusy} onClick={() => void setActiveEvent(null)}>
                Clear active event
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function withOrgFallback(orgId: string) {
  return orgId ? `/team/data?orgId=${encodeURIComponent(orgId)}` : "/team/data";
}
