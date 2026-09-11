"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../../components/ui";
import { hubHref } from "../../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import type { TeamDossierView } from "../../../lib/team-dossier/store";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import "./team-profile.css";

type View = TeamDossierView & { orgId: string | null };

function isTeamProfileView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return (
    status === "none" ||
    status === "queued" ||
    status === "running" ||
    status === "ready" ||
    status === "failed"
  );
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function teamProfileCacheOrg(data: View, orgHint: string): string {
  switch (data.status) {
    case "none":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "queued":
    case "running":
    case "ready":
    case "failed":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistTeamProfileSnapshot(orgHint: string, data: View): Promise<void> {
  const cacheOrg = teamProfileCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("team-profile", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("team-profile", "_", data);
  } catch {
    // Live Team profile already painted; IndexedDB is best-effort.
  }
}

function TeamProfileRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related team tools">
      <Button as="a" variant="secondary" href={hubHref("/competition", "district-advancement", orgId)}>
        Districts
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/business", "mock-judging", orgId)}>
        Mock judging
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/business", "award-tracker", orgId)}>
        Award tracker
      </Button>
    </nav>
  );
}

function TeamProfileNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "districts",
      label: "Open District advancement",
      detail: "Remaining district points use the same public record this page shows.",
      href: hubHref("/competition", "district-advancement", orgId),
      primary: true,
    },
    {
      id: "mock",
      label: "Open Mock judging",
      detail: "Practice award interviews with notes from this team's record.",
      href: hubHref("/business", "mock-judging", orgId),
      primary: false,
    },
    {
      id: "awards",
      label: "Open Award tracker",
      detail: "Season award submissions sit next to the public awards list.",
      href: hubHref("/business", "award-tracker", orgId),
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
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [building, setBuilding] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("team-profile", orgHint || "_");
      if (!viewRef.current && cached?.data && isTeamProfileView(cached.data)) {
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
      const response = await fetch(`/api/team/dossier${query.toString() ? `?${query.toString()}` : ""}`, {
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
      if (!response.ok || !isTeamProfileView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Team profile. Showing the last copy on this device.");
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
      await persistTeamProfileSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Team profile. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  const build = useCallback(async (nextOrgId: string) => {
    setBuilding(true);
    setError("");
    try {
      const response = await fetch("/api/team/dossier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: nextOrgId, action: "build" }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !isTeamProfileView(data)) {
        setError(responseError(data) || "Could not build the profile.");
        return;
      }
      const next = { ...data, orgId: data.orgId ?? nextOrgId };
      setView(next);
      setFromCache(false);
      void persistTeamProfileSnapshot(nextOrgId, next);
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

  const teamHref = orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team";
  const title =
    view && view.status !== "none" && "profile" in view && view.profile?.nickname
      ? `${view.teamNumber} · ${view.profile.nickname}`
      : "Team profile";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={teamHref}>Team</a>
          {" / Team profile"}
        </>
      }
      title={title}
      description="What The Blue Alliance and Statbotics have on record for this team. Ask AI uses these facts as context."
    >
      <TeamProfileRelated orgId={orgId} />
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
      <main className="module-page tp-page">
        {header}
        <OfflineBanner feature="Team profile" fromCache={fromCache} cachedAt={cachedAt} />
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
    case "none":
    case "queued":
    case "running":
      return (
        <main className="module-page tp-page">
          {header}
          <OfflineBanner feature="Team profile" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="tp-error" role="alert">
              {error}
            </p>
          ) : null}
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
              <Button variant="primary" type="button" disabled={building} onClick={() => void build(view.orgId!)}>
                {building ? "Building…" : "Build it now"}
              </Button>
            ) : view.status !== "none" ? (
              <Button variant="secondary" type="button" onClick={() => void load()}>
                Refresh
              </Button>
            ) : (
              <p className="app-muted">An owner or admin needs to open this page once to build it.</p>
            )}
          </EmptyState>
        </main>
      );
    case "failed":
    case "ready":
      break;
    default: {
      view satisfies never;
      return null;
    }
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
      <OfflineBanner feature="Team profile" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? <p className="tp-error" role="alert">{error}</p> : null}

      {view.status === "failed" ? (
        <p className="tp-error" role="alert">
          The last build failed: {view.error ?? "neither source answered"}.
        </p>
      ) : null}

      {view.status === "ready" && view.orgId ? <TeamProfileNextActions orgId={view.orgId} /> : null}

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
          <Button variant="secondary" type="button" disabled={building} onClick={() => void build(view.orgId!)}>
            {building ? "Rebuilding…" : "Rebuild now"}
          </Button>
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
