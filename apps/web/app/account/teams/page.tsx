import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button, PageHeader, Panel } from "../../../components/ui";
import { listTeamLifecycle } from "../../../lib/team-lifecycle/store";
import { TeamsList } from "./teams-client";
import "./team-lifecycle.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your teams" };

export default async function TeamsSettings({ searchParams }: { searchParams: Promise<{ orgId?: string; left?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Faccount%2Fteams");
  const { orgId, left } = await searchParams;
  const teams = await withRls({ userId: session.user.id }, (client) => listTeamLifecycle(client, session.user.id));
  // Only a short label the page itself put there ("Team 9201 · QA 2 Alpha"), shown as text.
  const leftLabel = left && left.length <= 120 ? left : null;
  return <main className="module-page" style={{ maxWidth: 760 }}>
    <PageHeader title="Your teams" description="Open a team, or leave one. Your account stays the same." breadcrumbs="Settings › Your teams">
      <Button as="a" variant="secondary" href={`/settings${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`}>Back to settings</Button>
    </PageHeader>
    {leftLabel ? <p role="status" className="lifecycle-notice">You left {leftLabel}. Your account and your other teams are unchanged.</p> : null}
    <Panel>
      {teams.length ? <TeamsList teams={teams} currentOrgId={orgId ?? null} /> : <p>No team yet. Join one with an invite or your team&rsquo;s code.</p>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}><Button as="a" variant="primary" href="/join-team">Join a team</Button><Button as="a" variant="secondary" href="/claim">Create a team</Button><a href="/invite">Use an invitation</a></div>
    </Panel>
  </main>;
}
