import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { teamAdminShellCopy, teamAdminSetupSteps } from "../../../lib/team/team-admin-related";
import { redirect } from "next/navigation";
import TeamAdminClient from "../team-admin-client";
import "../team-admin.css";
import { teamSettingsBreadcrumb } from "../../../lib/nav/team-settings-nav";
import { auth, canAccessHubTab, listMemberHubAccess } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export const metadata = {
  title: "Invites & access",
  description: "Invite people and choose what each person can open.",
};

/**
 * Team admin is people and invites only. Team profile and branding live on
 * /team/admin/profile, access presets on /team/admin/presets, and GitHub on
 * /connectors/github.
 */
export default async function TeamAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const orgId = typeof params.orgId === "string" ? params.orgId : undefined;
  if (!orgId) {
    const copy = teamAdminShellCopy("setup");
    const setup = teamAdminSetupSteps(null)[0];
    return (
      <main className="module-page team-admin-page soft-gate">
        <PageHeader
          breadcrumbs={teamSettingsBreadcrumb("people")}
          title="Team admin"
          description="Invite people, share your team join code, and choose what each person can open."
        />
        <EmptyState
          soft
          title={copy.title}
          description={copy.description}
          badge="Needs setup"
          badgeTone="setup"
        >
          <Button as="a" variant="primary" href={setup?.href ?? "/workspace"}>
            {setup?.label ?? "Choose your team"}
          </Button>
        </EmptyState>
      </main>
    );
  }
  const session = await auth.api.getSession({ headers: await headers() });
  const access = session ? await withRls({ userId: session.user.id, orgId }, async client => {
    const allowed = (await client.query<{ allowed: boolean }>("SELECT has_org_capability($1::uuid,'manage_members') AS allowed", [orgId])).rows[0]?.allowed === true;
    if (!allowed) return { allowed: false, people: false };
    const role = (await client.query<{ role: string }>("SELECT role::text AS role FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid", [orgId, session.user.id])).rows[0]?.role;
    return { allowed, people: role === "owner" || role === "admin" || canAccessHubTab(await listMemberHubAccess(client, orgId, session.user.id), "team", "attendance") };
  }) : { allowed: false, people: false };
  if (!access.allowed) return (
    <main className="module-page team-admin-page soft-gate">
      <PageHeader title="Team admin" description="Manage your team's people and invitations." />
      <EmptyState title="Team administrator access required" description="Your team role does not include managing people or invitations.">
        <Button as="a" href={`/dashboard?orgId=${encodeURIComponent(orgId)}`}>Back to Home</Button>
      </EmptyState>
    </main>
  );
  // A delegated member manager may not have the Team hub. Keep the existing
  // authorized entry usable without expanding that person's hub permissions.
  if (!access.people) return <TeamAdminClient orgId={orgId} />;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach(item => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  }
  query.set("tab", "attendance");
  query.set("view", "access");
  redirect(`/team?${query}`);
}
