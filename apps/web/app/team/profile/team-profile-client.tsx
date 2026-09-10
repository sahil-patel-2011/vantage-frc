"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import type { TeamDossierView } from "../../../lib/team-dossier/store";
import "./team-profile.css";

type View = TeamDossierView & { orgId: string | null };

/**
 * What the world already knows about this team.
 *
 * The first thing a new team sees is that Vantage knows who they are — where
 * they are, how long they have competed, what they have won, how seasons went —
 * without anyone typing it in. All of it is from The Blue Alliance and
 * Statbotics; every AI feature gets the same facts as context.
 *
 * People are the one thing deliberately NOT gathered from outside: no public
 * source knows a team's mentors or students, so the roster here is Vantage's
 * own memberships and nothing else.
 */
export default function TeamProfileClient() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [building, setBuilding] = useState(false);

  const load = useCallback(async () => {
    try {
      const org = new URLSearchParams(window.location.search).get("orgId");
      const response = await fetch(`/api/team/dossier${org ? `?orgId=${encodeURIComponent(org)}` : ""}`);
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not load the team profile.");
        return;
      }
      setView(data);
      setError("");
    } catch {
      setError("Could not reach the server.");
    }
  }, []);

  const build = useCallback(async (orgId: string) => {
    setBuilding(true);
    setError("");
    try {
      const response = await fetch("/api/team/dossier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "build" }),
      });
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok) setError(data.error ?? "Could not build the profile.");
      else setView({ ...data, orgId });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBuilding(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // First visit by a lead: build it without asking. That is the whole point —
  // the team should not have to tell Vantage who they are.
  useEffect(() => {
    if (view && view.status === "none" && view.canBuild && view.orgId && !building) void build(view.orgId);
  }, [view, building, build]);

  const header = (
    <PageHeader
      breadcrumbs="Team / Profile"
      title={view && view.status !== "none" && view.profile?.nickname ? `${view.teamNumber} · ${view.profile.nickname}` : "Team profile"}
      description="What The Blue Alliance and Statbotics have on record for this team. Vantage's AI features use these facts as context."
    />
  );

  if (!view) {
    return (
      <main className="module-page tp-page">
        {header}
        {error ? <p className="tp-error" role="alert">{error}</p> : <p className="app-muted">Loading…</p>}
      </main>
    );
  }

  if (view.status === "none" || view.status === "queued" || view.status === "running") {
    return (
      <main className="module-page tp-page">
        {header}
        {error ? <p className="tp-error" role="alert">{error}</p> : null}
        <EmptyState
          soft
          badge={view.status === "none" ? "Not built yet" : "Building"}
          badgeTone="setup"
          title={view.status === "none" ? "No profile yet" : "Gathering the public record"}
          description={
            view.teamNumber
              ? `Looking up team ${view.teamNumber} on The Blue Alliance and Statbotics. This takes a few seconds and happens once; it refreshes weekly after that.`
              : "This team has no team number, so there is nothing to look up. Set it on the Team settings page."
          }
        >
          {view.canBuild && view.orgId && view.status === "none" ? (
            <button type="button" className="app-button" disabled={building} onClick={() => void build(view.orgId!)}>
              {building ? "Building…" : "Build it now"}
            </button>
          ) : view.status !== "none" ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Refresh
            </button>
          ) : (
            <p className="app-muted">An owner or admin needs to open this page once to build it.</p>
          )}
        </EmptyState>
      </main>
    );
  }

  const p = view.profile;
  const seasons = new Set(view.yearsParticipated).size;
  const location = [p?.city, p?.stateProv, p?.country].filter(Boolean).join(", ");
  const latest = view.stats?.years[0] ?? null;
  const awardsByYear = new Map<number, string[]>();
  for (const a of view.awards) awardsByYear.set(a.year, [...(awardsByYear.get(a.year) ?? []), a.name]);

  return (
    <main className="module-page tp-page">
      {header}
      {error ? <p className="tp-error" role="alert">{error}</p> : null}

      {view.status === "failed" ? (
        <p className="tp-error" role="alert">
          The last build failed: {view.error ?? "neither source answered"}.
        </p>
      ) : null}

      <div className="tp-grid">
        <Panel className="tp-card">
          <span className="biz-overline">Who</span>
          <h2>{p?.nickname ?? `Team ${view.teamNumber}`}</h2>
          <dl className="tp-facts">
            <Fact label="Team number" value={String(view.teamNumber)} />
            <Fact label="Location" value={location || null} />
            <Fact label="School / organisation" value={p?.schoolName ?? null} />
            <Fact label="Rookie year" value={p?.rookieYear ? String(p.rookieYear) : null} />
            <Fact label="Seasons competed" value={seasons > 0 ? `${seasons} (per TBA)` : null} />
            <Fact
              label="Website"
              value={p?.website ?? null}
              href={p?.website && /^https?:\/\//.test(p.website) ? p.website : undefined}
            />
          </dl>
          {p?.name ? <small className="app-muted">Full TBA name: {p.name}</small> : null}
        </Panel>

        <Panel className="tp-card">
          <span className="biz-overline">People</span>
          <h2>Roster</h2>
          <dl className="tp-facts">
            <Fact label="On Vantage" value={`${view.roster.total}`} />
            <Fact label="Owners / admins" value={`${view.roster.owners} / ${view.roster.admins}`} />
            <Fact label="Members" value={`${view.roster.members}`} />
          </dl>
          <p className="app-muted">
            No public source knows who a team&rsquo;s mentors and students are, so this is your own roster —
            nothing scraped. <a href="/attendance">Manage people</a>.
          </p>
        </Panel>

        <Panel className="tp-card">
          <span className="biz-overline">How it has gone</span>
          <h2>Results</h2>
          {view.stats ? (
            <dl className="tp-facts">
              <Fact label="Normalised EPA (career)" value={view.stats.normEpa !== null ? String(view.stats.normEpa) : null} />
              <Fact
                label="Career record"
                value={view.stats.record ? `${view.stats.record.wins}-${view.stats.record.losses}-${view.stats.record.ties} (${Math.round(view.stats.record.winrate * 100)}%)` : null}
              />
              {latest ? (
                <>
                  <Fact label={`${latest.year} EPA`} value={latest.epa !== null ? String(latest.epa) : null} />
                  <Fact
                    label={`${latest.year} world rank`}
                    value={latest.rankWorld !== null ? `${latest.rankWorld}${latest.teamsWorld ? ` of ${latest.teamsWorld}` : ""}` : null}
                  />
                  <Fact label={`${latest.year} state / district rank`} value={[latest.rankState, latest.rankDistrict].filter((v) => v !== null).join(" / ") || null} />
                </>
              ) : null}
            </dl>
          ) : (
            <p className="app-muted">
              Statbotics did not answer{view.sources.statbotics?.error ? ` (${view.sources.statbotics.error})` : ""}. Results will
              fill in on the next refresh.
            </p>
          )}
          {view.stats && view.stats.years.length > 1 ? (
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th>EPA</th>
                  <th>World rank</th>
                </tr>
              </thead>
              <tbody>
                {view.stats.years.slice(0, 8).map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td>{y.epa ?? "—"}</td>
                    <td>{y.rankWorld !== null ? `${y.rankWorld}${y.teamsWorld ? ` / ${y.teamsWorld}` : ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Panel>

        <Panel className="tp-card tp-wide">
          <span className="biz-overline">Recent seasons</span>
          <h2>Events</h2>
          {view.events.length === 0 ? (
            <p className="app-muted">
              {view.sources.tba?.ok === false
                ? `The Blue Alliance did not answer${view.sources.tba.error ? ` (${view.sources.tba.error})` : ""}.`
                : "No events on record for the last two seasons this team competed."}
            </p>
          ) : (
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th>Event</th>
                  <th>Wk</th>
                  <th>Qual rank</th>
                  <th>Record</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {view.events.map((e) => (
                  <tr key={e.eventKey}>
                    <td>{e.year}</td>
                    <td>
                      <a href={`https://www.thebluealliance.com/event/${e.eventKey}`} target="_blank" rel="noreferrer">
                        {e.name ?? e.eventKey}
                      </a>
                    </td>
                    <td>{e.week ?? "—"}</td>
                    <td>{e.rank !== null ? `${e.rank}${e.teams ? ` / ${e.teams}` : ""}` : "—"}</td>
                    <td>{e.wins !== null && e.losses !== null ? `${e.wins}-${e.losses}-${e.ties ?? 0}` : "—"}</td>
                    <td className="tp-outcome">{e.playoff ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel className="tp-card tp-wide">
          <span className="biz-overline">What it has won</span>
          <h2>Awards</h2>
          {view.awards.length === 0 ? (
            <p className="app-muted">
              {view.sources.tba?.ok === false ? "The Blue Alliance did not answer." : "No awards on record with TBA."}
            </p>
          ) : (
            <ul className="tp-awards">
              {[...awardsByYear.entries()].map(([year, names]) => (
                <li key={year}>
                  <strong>{year}</strong>
                  <span>{names.join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <footer className="tp-foot">
        <span className="app-muted">
          Sources: The Blue Alliance {view.sources.tba?.ok ? "✓" : "✗"} · Statbotics {view.sources.statbotics?.ok ? "✓" : "✗"}
          {view.computedAt ? ` · built ${view.computedAt.slice(0, 10)}` : ""} · refreshes weekly
        </span>
        {view.canBuild && view.orgId ? (
          <button type="button" className="app-button secondary" disabled={building} onClick={() => void build(view.orgId!)}>
            {building ? "Rebuilding…" : "Rebuild now"}
          </button>
        ) : null}
      </footer>
    </main>
  );
}

function Fact({ label, value, href }: { label: string; value: string | null; href?: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {value === null ? (
          <span className="app-muted">not on record</span>
        ) : href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </>
  );
}
