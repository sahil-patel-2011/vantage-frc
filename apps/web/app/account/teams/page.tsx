import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button, PageHeader, Panel } from "../../../components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your teams" };

export default async function TeamsSettings({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Faccount%2Fteams");
  const { orgId } = await searchParams;
  const teams = await withRls({ userId: session.user.id }, async client => {
    const result = await client.query<{ id: string; name: string; number: number | null; role: string }>(
      `SELECT o.id, o.name, o.team_number AS number, m.role FROM memberships m
       JOIN organizations o ON o.id=m.org_id WHERE m.user_id=$1 ORDER BY o.name`, [session.user.id],
    );
    return result.rows;
  });
  return <main className="module-page" style={{ maxWidth: 760 }}>
    <PageHeader title="Your teams" description="Choose the team you’re working with. Your account stays the same." breadcrumbs="Settings / Teams">
      <Button as="a" variant="secondary" href={`/account${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`}>Back to settings</Button>
    </PageHeader>
    <Panel><ul className="dash-checklist">{teams.map(team => <li key={team.id}><a href={`/dashboard?orgId=${team.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "12px 0", width: "100%" }}>
      <span><strong>{team.number ? `Team ${team.number}` : team.name}</strong><small style={{ display: "block" }}>{team.name} · {team.role.charAt(0).toUpperCase()+team.role.slice(1)}</small></span><span>{team.id === orgId ? "Current" : "Open →"}</span>
    </a></li>)}</ul>{!teams.length ? <p>No team yet. Create one or use an invitation.</p> : null}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}><Button as="a" variant="primary" href="/join-team">Join a team</Button><Button as="a" variant="secondary" href="/claim">Create a team</Button><a href="/invite">Use an invitation</a></div>
    </Panel>
  </main>;
}
