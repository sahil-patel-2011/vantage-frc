import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button, PageHeader } from "../../../components/ui";
import { TeamsClient } from "./teams-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your teams" };

export default async function TeamsSettings({ searchParams }: { searchParams: Promise<{ orgId?: string; left?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Faccount%2Fteams");
  const { orgId, left } = await searchParams;
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
    {left === "1" ? <p role="status">You’ve left the team. Your account is still active.</p> : null}
    <TeamsClient teams={teams} userId={session.user.id} currentOrgId={orgId} />
  </main>;
}
