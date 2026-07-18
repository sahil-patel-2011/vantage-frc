import { assertOrgAuthentication, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { loadDataSourceHealth } from "../../lib/reference-health";
import SyncIndicator from "./sync-indicator";
import QuickActions from "./quick-actions";
import { VantageLogo } from "../../components/brand";

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId: orgIdParam } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Fworkspace");

  let orgId = orgIdParam ?? null;
  if (!orgId) {
    const memberships = await withRls({ userId: session.user.id }, async (client) =>
      client.query<{ orgId: string; orgName: string; teamNumber: number | null }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1
         ORDER BY o.name`,
        [session.user.id],
      ),
    );
    if (memberships.rows.length === 1) {
      redirect(`/workspace?orgId=${encodeURIComponent(memberships.rows[0]!.orgId)}`);
    }
        if (memberships.rows.length === 0) {
      return (
        <main className="onboarding-page">
          <section className="onboarding-card">
            <h1>Join a team workspace</h1>
            <p className="onboarding-sub">Access comes from a verified invitation. Accept an invite link, then return here.</p>
            <div className="onboarding-callout">
              <strong>Closed membership</strong>
              <p>Vantage does not open workspaces from team numbers alone. Ask your coach or platform admin for an invite to your verified email.</p>
            </div>
            <a className="signin-submit" href="/dashboard" style={{ display: "inline-flex", width: "auto", textDecoration: "none" }}>
              Back to dashboard
            </a>
          </section>
        </main>
      );
    }
    return (
      <main className="onboarding-page">
        <section className="onboarding-card">
          <h1>Select your team workspace</h1>
          <p className="onboarding-sub">You belong to more than one organization. Pick one to continue.</p>
          <ul className="dash-checklist">
            {memberships.rows.map((row) => (
              <li key={row.orgId}>
                <a href={`/workspace?orgId=${encodeURIComponent(row.orgId)}`}>
                  {row.orgName}
                  {row.teamNumber ? ` · Team ${row.teamNumber}` : ""}
                </a>
              </li>
            ))}
          </ul>
          <a className="signin-link" href="/dashboard">
            Back to dashboard
          </a>
        </section>
      </main>
    );
  }

  const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
    const membership = await client.query<{ role: string }>(
      "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2",
      [orgId, session.user.id],
    );
    if (!membership.rows[0]) throw new Error("Organization access denied");
    try {
      await assertOrgAuthentication(client, {
        userId: session.user.id,
        orgId,
        sessionId: session.session.id,
        authMethod: String(
          (session.session as typeof session.session & { authMethod?: string }).authMethod ?? "unknown",
        ),
        rememberedDeviceToken: (await cookies()).get("vantage_mfa_device")?.value,
      });
    } catch {
      redirect(
        `/security?orgId=${encodeURIComponent(orgId)}&stepup=1&returnTo=${encodeURIComponent(`/workspace?orgId=${orgId}`)}`,
      );
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

  return (
    <main className="workspace-page">
      <header className="workspace-top">
        <VantageLogo href="/dashboard" />
        <a className="display-nav" href={`/display?orgId=${orgId}`} aria-label="Open TV Display Mode setup">
          Γûú <span>DISPLAY</span>
        </a>
        <SyncIndicator />
        <span>
          {session.user.name} ┬╖ {data.role.toUpperCase()}
        </span>
      </header>
      <section className={`active-event ${data.context.eventKey ? "" : "inactive"}`}>
        <div>
          <span className="eyebrow">ACTIVE EVENT</span>
          <h1>{data.context.eventName ?? "No event selected"}</h1>
          <p>
            {data.context.eventKey
              ? data.context.eventKey
              : "An owner or admin must set the active competition context before match queues populate."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {!data.context.eventKey && ["owner", "admin"].includes(data.role) ? (
            <a href={`/command?orgId=${encodeURIComponent(orgId)}`}>Select event</a>
          ) : null}
          {["owner", "admin"].includes(data.role) ? (
            <>
              <a href={`/team/data?orgId=${encodeURIComponent(orgId)}`}>TBA data</a>
              <a href={`/team?orgId=${encodeURIComponent(orgId)}`}>Team controls</a>
            </>
          ) : null}
        </div>
      </section>
      <QuickActions orgId={orgId} />
      <DataSourceDegradedBanner health={data.dataSourceHealth} />
      <aside className="freshness-marker" role="status">
        <strong>TBA reference cache</strong>
        <span>
          {data.freshness.syncedAt
            ? `Last updated ${new Date(data.freshness.syncedAt).toLocaleString()}`
            : "Not yet synced — connect TBA and run a sync before expecting live match times."}
        </span>
        {data.dataSourceHealth.usingLastGoodCache ? (
          <small>Using last-known-good Neon cache · upstream temporarily degraded</small>
        ) : data.freshness.lastError ? (
          <small>Using last-known-good data · source temporarily unavailable</small>
        ) : null}
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
          <p>
            {data.context.eventKey
              ? "No upcoming synced matches yet. Run TBA sync after the schedule is published."
              : "Select an active event to load the match queue."}
          </p>
        )}
      </section>
    </main>
  );
}
