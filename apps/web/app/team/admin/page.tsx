import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { teamAdminShellCopy, teamAdminSetupSteps } from "../../../lib/team/team-admin-related";
import TeamAdminClient from "../team-admin-client";
import "../team-admin.css";
import { teamSettingsBreadcrumb } from "../../../lib/nav/team-settings-nav";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export const metadata = {
  title: "Team admin",
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
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = teamAdminShellCopy("setup");
    const setup = teamAdminSetupSteps(null)[0];
    return (
      <main className="module-page team-admin-page soft-gate">
        <PageHeader
          breadcrumbs={teamSettingsBreadcrumb("people")}
          title="Team admin"
          description="Invite people and choose what each person can open. People without an invite go to the waitlist."
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
  const allowed = session ? await withRls({ userId: session.user.id, orgId }, async client =>
    (await client.query<{ allowed: boolean }>("SELECT has_org_capability($1::uuid,'manage_members') AS allowed", [orgId])).rows[0]?.allowed === true,
  ) : false;
  if (!allowed) return (
    <main className="module-page team-admin-page soft-gate">
      <PageHeader title="Team admin" description="Manage your team's people and invitations." />
      <EmptyState title="Team administrator access required" description="Your team role does not include managing people or invitations.">
        <Button as="a" href={`/dashboard?orgId=${encodeURIComponent(orgId)}`}>Back to Home</Button>
      </EmptyState>
    </main>
  );
  return <TeamAdminClient orgId={orgId} />;
}
