import { Button } from "../../components/ui";
import { assertOrgAuthentication } from "@vantage/core";
import { withRls } from "@vantage/db";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { isE2eFixtureCookie, resolveRequestActor } from "../../lib/auth/request-actor";
import { loadDataSourceHealth } from "../../lib/reference-health";
import {
  classifyWorkspaceShell,
  formatWorkspaceOrgLabel,
  realWorkspaceMemberships,
  workspaceJoinNextActions,
  workspaceOrgHref,
  workspaceShellCopy,
} from "../../lib/workspace";
import SyncIndicator from "./sync-indicator";
import QuickActions from "./quick-actions";
import { VantageLogo } from "../../components/brand";
import "../invite/invite-flow.css";

export const metadata = {
  title: "Your team",
};

// Session-gated server page: never prerendered, so a credential-free build works.
export const dynamic = "force-dynamic";

function WorkspaceEmptyJoin() {
  const copy = workspaceShellCopy("empty");
  const actions = workspaceJoinNextActions("empty");
  const primary = actions.find((action) => action.primary) ?? actions[0];
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
        <ul className="workspace-quiet-links">
          {actions
            .filter((action) => action.id !== primary?.id)
            .map((action) => (
              <li key={action.id}>
                <a href={action.href}>{action.label}</a>
                <span>{action.detail}</span>
              </li>
            ))}
        </ul>
      </section>
    </main>
  );
}

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId: orgIdParam } = await searchParams;
  const cookieHeader = (await headers()).get("cookie");
  const actor = await resolveRequestActor();
  if (!actor) {
    if (isE2eFixtureCookie(cookieHeader)) return <WorkspaceEmptyJoin />;
    redirect("/signin?next=%2Fworkspace");
  }

  const orgId = orgIdParam ?? null;
  if (!orgId) {
    const memberships = await withRls({ userId: actor.userId }, async (client) =>
      client.query<{ orgId: string; orgName: string; teamNumber: number | null }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1
         ORDER BY o.name`,
        [actor.userId],
      ),
    );
    const options = realWorkspaceMemberships(memberships.rows);
    const shell = classifyWorkspaceShell({ membershipCount: options.length });

    if (shell === "ready" && options[0]) {
      redirect(workspaceOrgHref(options[0].orgId));
    }

    if (shell === "empty") {
      return <WorkspaceEmptyJoin />;
    }

    const copy = workspaceShellCopy("select");
    const actions = workspaceJoinNextActions("select");
    return (
      <main className="onboarding-page invite-flow-page">
        <section className="onboarding-card invite-flow-card" aria-labelledby="workspace-select-title">
          <header className="invite-flow-header">
            <div className="onboarding-brand">
              <VantageLogo />
            </div>
            <h1 id="workspace-select-title">{copy.title}</h1>
            <p className="onboarding-sub">{copy.description}</p>
          </header>
          <ul className="dash-checklist workspace-org-pick">
            {options.map((row) => (
              <li key={row.orgId}>
                <a href={workspaceOrgHref(row.orgId)}>{formatWorkspaceOrgLabel(row)}</a>
              </li>
            ))}
          </ul>
          <ul className="workspace-quiet-links">
            {actions.map((action) => (
              <li key={action.id}>
                <a href={action.href}>{action.label}</a>
                <span>{action.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    );
  }

  const data = await withRls({ userId: actor.userId, orgId }, async (client) => {
    const membership = await client.query<{ role: string }>(
      "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2",
      [orgId, actor.userId],
    );
    if (!membership.rows[0]) throw new Error("Organization access denied");
    if (actor.sessionId) {
      try {
        await assertOrgAuthentication(client, {
          userId: actor.userId,
          orgId,
          sessionId: actor.sessionId,
          authMethod: actor.authMethod,
          rememberedDeviceToken: (await cookies()).get("vantage_mfa_device")?.value,
        });
      } catch {
        redirect(
          `/security?orgId=${encodeURIComponent(orgId)}&stepup=1&returnTo=${encodeURIComponent(`/workspace?orgId=${orgId}`)}`,
        );
      }
    }
    const context = await client.query<{ eventKey: string | null; eventName: string | null }>(
      `SELECT c.active_event_key AS "eventKey", e.name AS "eventName"
       FROM org_active_context c
       LEFT JOIN events_ref e ON e.event_key = c.active_event_key
       WHERE c.org_id = $1`,
      [orgId],
    );
    const next = context.rows[0]?.eventKey
      ? await client.query(
          `SELECT match_key AS "matchKey", comp_level AS "compLevel", match_number AS "matchNumber",
            event_time AS "eventTime"
           FROM matches_ref WHERE event_key = $1
           AND COALESCE(actual_time, event_time, predicted_time) > now()
           ORDER BY COALESCE(actual_time, event_time, predicted_time)
           LIMIT 2`,
          [context.rows[0].eventKey],
        )
      : { rows: [] };
    const eventKey = context.rows[0]?.eventKey ?? null;
    const freshness = await client.query<{ syncedAt: string | null; lastError: string | null }>(
      eventKey
        ? `SELECT max(m.synced_at)::text AS "syncedAt",
                  (SELECT details->>'error' FROM data_source_health WHERE source='tba' LIMIT 1) AS "lastError"
           FROM matches_ref m WHERE m.event_key = $1`
        : `SELECT synced_at::text AS "syncedAt", last_error AS "lastError" FROM tba_cache_freshness LIMIT 1`,
      eventKey ? [eventKey] : [],
    );
    const dataSourceHealth = await loadDataSourceHealth(client, orgId);
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
          {actor.name} · {data.role}
        </span>
      </header>
      <section className={`active-event ${data.context.eventKey ? "" : "inactive"}`}>
        <div>
          <span className="eyebrow">ACTIVE EVENT</span>
          <h1>{data.context.eventName ?? "No event selected"}</h1>
          <p>
            {data.context.eventKey
              ? data.context.eventKey
              : isOwnerAdmin
                ? "Set the active event to load match queues."
                : "An owner or admin sets the active event."}
          </p>
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
      <DataSourceDegradedBanner health={data.dataSourceHealth} />
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
          <span className="eyebrow">NOW / NEXT</span>
          <h2>Match queue</h2>
        </div>
        {data.next.length ? (
          data.next.map((match: Record<string, unknown>, index) => (
            <article key={String(match.matchKey)}>
              <span>{index === 0 ? "NEXT" : "AFTER"}</span>
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
