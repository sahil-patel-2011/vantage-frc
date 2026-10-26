import { Button } from "../../components/ui";
import { assertOrgAuthentication, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { loadDataSourceHealth } from "../../lib/reference-health";
import {
  classifyWorkspaceShell,
  formatWorkspaceOrgLabel,
  realWorkspaceMemberships,
  workspaceJoinNextActions,
  workspaceNotOnTeamCopy,
  workspaceOrgHref,
  workspaceShellCopy,
} from "../../lib/workspace";
import { accessRoleLabel } from "../../lib/team-lifecycle/model";
import SyncIndicator from "./sync-indicator";
import QuickActions from "./quick-actions";
import { VantageLogo } from "../../components/brand";
import { scoutEventLabel } from "../../lib/scouting/scouting-related";
import "../invite/invite-flow.css";
import "./workspace-chooser.css";

export const metadata = {
  title: "Your team",
};

// Session-gated server page: never prerendered, so a credential-free build works.
export const dynamic = "force-dynamic";

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ orgId?: string; next?: string; notOnTeam?: string }> }) {
  const { orgId: orgIdParam, next: nextDestination, notOnTeam } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Fworkspace");

  // Explicit picker intent wins over a stale scope added by an older client.
  const orgId = nextDestination !== undefined ? null : orgIdParam ?? null;
  if (!orgId) {
    const memberships = await withRls({ userId: session.user.id }, async (client) =>
      client.query<{ orgId: string; orgName: string; teamNumber: number | null; role: string }>(
        // The order /api/me and the team switcher use: the teams you run first, then by number.
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role::text AS role
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number NULLS LAST, o.name`,
        [session.user.id],
      ),
    );
    const options = realWorkspaceMemberships(memberships.rows);
    const roleOf = new Map(memberships.rows.map((row) => [row.orgId, row.role]));
    const shell = classifyWorkspaceShell({ membershipCount: options.length });

    if (shell === "ready" && options[0] && nextDestination === undefined) {
      redirect(workspaceOrgHref(options[0].orgId, nextDestination));
    }

    if (shell === "empty") {
      const copy = workspaceShellCopy("empty");
      const actions = workspaceJoinNextActions("empty");
      const primary = actions.find((a) => a.primary) ?? actions[0];
      return (
        <main className="onboarding-page invite-flow-page">
          <section className="onboarding-card invite-flow-card" aria-labelledby="workspace-join-title">
            <header className="invite-flow-header">
              <div className="onboarding-brand">
                <VantageLogo />
              </div>
              <h1 id="workspace-join-title">{copy.title}</h1>
              <p className="onboarding-sub">{copy.description}</p>
            </header>
            {primary ? (
              <p className="invite-primary-cta">
                <Button as="a" variant="primary" href={primary.href}>
                  {primary.label}
                </Button>
              </p>
            ) : null}
            {actions
              .filter((a) => a.id !== primary?.id)
              .map((action) => (
                <p key={action.id} className="workspace-team-more">
                  <Button as="a" variant="secondary" href={action.href}>
                    {action.label}
                  </Button>
                  <span>{action.detail}</span>
                </p>
              ))}
          </section>
        </main>
      );
    }

    const notMember = notOnTeam === "1";
    // "Switch team" from any page lands here with ?next=. With one team, this said "You belong to
    // more than one team" over a list of one; it is one clear button instead.
    const only = options.length === 1 ? options[0] : null;
    const copy = notMember
      ? workspaceNotOnTeamCopy(options)
      : only
        ? { title: "Your team", description: "You're on one team. Open it, or join another team with an invite." }
        : workspaceShellCopy("select");
    // Leaving or renaming a team lives in Account → Your teams; say where, from the team picker.
    const actions = [
      ...workspaceJoinNextActions("select"),
      { id: "manage", label: "Manage your teams", detail: "Leave a team, or see your role on each.", href: "/account/teams" },
    ];
    return (
      <main className="onboarding-page invite-flow-page">
        <section className="onboarding-card invite-flow-card workspace-chooser" aria-labelledby="workspace-select-title">
          <header className="invite-flow-header">
            <div className="onboarding-brand">
              <VantageLogo />
            </div>
            <h1 id="workspace-select-title">{copy.title}</h1>
            <p className="onboarding-sub">{copy.description}</p>
          </header>
          {only ? (
            // One team to go back to: one clear button, not a list of one.
            <p className="invite-primary-cta">
              <Button as="a" variant="primary" href={workspaceOrgHref(only.orgId, nextDestination)}>
                Go to {formatWorkspaceOrgLabel(only)}
              </Button>
            </p>
          ) : (
            <ul className="workspace-team-list" aria-label="Your teams">
              {options.map((row) => (
                <li key={row.orgId}>
                  <a className="workspace-team-row" href={workspaceOrgHref(row.orgId, nextDestination)}>
                    <span className="workspace-team-text">
                      <strong>{formatWorkspaceOrgLabel(row)}</strong>
                      <small>{accessRoleLabel(roleOf.get(row.orgId))}</small>
                    </span>
                    <span className="workspace-team-chevron" aria-hidden="true">
                      ›
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {actions.map((action) => (
            <p key={action.id} className="workspace-team-more">
              <Button as="a" variant="secondary" href={action.href}>
                {action.label}
              </Button>
              <span>{action.detail}</span>
            </p>
          ))}
        </section>
      </main>
    );
  }

  const rememberedDevice = (await cookies()).get("vantage_mfa_device")?.value;
  const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
    const membershipP = client.query<{ role: string }>(
      "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2",
      [orgId, session.user.id],
    );
    const authP = assertOrgAuthentication(client, {
      userId: session.user.id,
      orgId,
      sessionId: session.session.id,
      authMethod: String(
        (session.session as typeof session.session & { authMethod?: string }).authMethod ?? "unknown",
      ),
      rememberedDeviceToken: rememberedDevice,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    const contextP = client.query<{ eventKey: string | null; eventName: string | null }>(
      `SELECT c.active_event_key AS "eventKey", e.name AS "eventName"
       FROM org_active_context c
       LEFT JOIN events_ref e ON e.event_key = c.active_event_key
       WHERE c.org_id = $1`,
      [orgId],
    );
    const nextP = client.query(
      `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
              m.event_time AS "eventTime"
       FROM org_active_context c
       JOIN matches_ref m ON m.event_key = c.active_event_key
       WHERE c.org_id = $1
         AND COALESCE(m.actual_time, m.event_time, m.predicted_time) > now()
       ORDER BY COALESCE(m.actual_time, m.event_time, m.predicted_time)
       LIMIT 2`,
      [orgId],
    );
    const freshnessP = client.query<{ syncedAt: string | null; lastError: string | null }>(
      `SELECT COALESCE(max(m.synced_at)::text, (SELECT synced_at::text FROM tba_cache_freshness LIMIT 1)) AS "syncedAt",
              COALESCE(
                (SELECT details->>'error' FROM data_source_health WHERE source = 'tba' LIMIT 1),
                (SELECT last_error FROM tba_cache_freshness LIMIT 1)
              ) AS "lastError"
       FROM org_active_context c
       LEFT JOIN matches_ref m ON m.event_key = c.active_event_key
       WHERE c.org_id = $1`,
      [orgId],
    );
    const healthP = loadDataSourceHealth(client, orgId);
    const [membership, authError, context, next, freshness, dataSourceHealth] = await Promise.all([
      membershipP,
      authP,
      contextP,
      nextP,
      freshnessP,
      healthP,
    ]);
    if (!membership.rows[0]) throw new Error("Organization access denied");
    if (authError) {
      redirect(
        `/security?orgId=${encodeURIComponent(orgId)}&stepup=1&returnTo=${encodeURIComponent(`/workspace?orgId=${orgId}`)}`,
      );
    }
    return {
      role: membership.rows[0].role,
      context: context.rows[0] ?? { eventKey: null, eventName: null },
      next: next.rows,
      freshness: freshness.rows[0] ?? { syncedAt: null, lastError: null },
      dataSourceHealth,
    };
  });

  const isOwnerAdmin = ["owner", "admin"].includes(data.role);

  return (
    <main className="workspace-page">
      <header className="workspace-top">
        <VantageLogo href="/dashboard" />
        <a className="display-nav" href={`/display?orgId=${orgId}`} aria-label="Open TV Display Mode setup">
          Display
        </a>
        <SyncIndicator />
        <span>
          {session.user.name} · {data.role}
        </span>
      </header>
      <section className={`active-event ${data.context.eventKey ? "" : "inactive"}`}>
        <div>
          <span className="eyebrow">Active event</span>
          <h1>{data.context.eventName ?? "No event selected"}</h1>
          {data.context.eventName?.trim() ? null : (
            <p>
              {data.context.eventKey
                ? scoutEventLabel({ eventKey: data.context.eventKey })
                : isOwnerAdmin
                  ? "Set the active event to load match queues."
                  : "An owner or admin sets the active event."}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {!data.context.eventKey && isOwnerAdmin ? (
            <a href={`/command?orgId=${encodeURIComponent(orgId)}`}>Set active event</a>
          ) : null}
          {isOwnerAdmin ? (
            <>
              <a href={`/team/data?orgId=${encodeURIComponent(orgId)}`}>TBA data</a>
              <a href={`/team?orgId=${encodeURIComponent(orgId)}`}>Team</a>
            </>
          ) : null}
        </div>
      </section>
      <QuickActions orgId={orgId} />
      <DataSourceDegradedBanner health={data.dataSourceHealth} canOpenTeamData={isOwnerAdmin} />
      <aside className="freshness-marker" role="status">
        <strong>TBA cache</strong>
        <span>
          {data.freshness.syncedAt
            ? `Updated ${new Date(data.freshness.syncedAt).toLocaleString()}`
            : "Not synced yet."}
        </span>
      </aside>
      <section className="now-next">
        <div>
          <span className="eyebrow">Now and next</span>
          <h2>Match queue</h2>
        </div>
        {data.next.length ? (
          data.next.map((match: Record<string, unknown>, index) => (
            <article key={String(match.matchKey)}>
              <span>{index === 0 ? "Next" : "After"}</span>
              <strong>
                {String(match.compLevel).toUpperCase()} {String(match.matchNumber)}
              </strong>
              <time>
                {match.eventTime
                  ? new Date(String(match.eventTime)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                  : "Time pending"}
              </time>
            </article>
          ))
        ) : (
          <p>{data.context.eventKey ? "No upcoming matches synced yet." : "Set your active event first."}</p>
        )}
      </section>
    </main>
  );
}
