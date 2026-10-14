import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { Button, EmptyState, PageHeader } from "../../../../components/ui";
import { teamSettingsBreadcrumb } from "../../../../lib/nav/team-settings-nav";
import { TeamPermissionsClient } from "./permissions-client";
import "../../team-admin.css";

export const metadata = {
  title: "Roles and permissions",
  description: "Everyone on the team in one table: their access and the parts of the app they can open.",
};

/** One grid for the whole team. Each person's Access window on Members and invites still works. */
export default async function TeamPermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const header = (
    <PageHeader
      breadcrumbs={teamSettingsBreadcrumb("permissions")}
      title="Roles and permissions"
      description="Choose each person's access and which parts of the app they can open."
    />
  );
  if (!orgId) {
    return (
      <main className="module-page team-admin-page soft-gate">
        {header}
        <EmptyState soft badge="Needs setup" badgeTone="setup" title="Choose your team" description="Permissions belong to one team.">
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  const session = await auth.api.getSession({ headers: await headers() });
  const access = session
    ? await withRls({ userId: session.user.id, orgId }, async (client) =>
        (
          await client.query<{ lead: boolean; member: boolean }>(
            "SELECT has_org_role($1::uuid, ARRAY['owner','admin']::org_role[]) AS lead, is_org_member($1::uuid) AS member",
            [orgId],
          )
        ).rows[0] ?? null,
      ).catch(() => null)
    : null;
  if (!access?.lead) {
    return (
      <main className="module-page team-admin-page soft-gate">
        {header}
        <EmptyState
          title={access?.member ? "The team owner and mentors set permissions" : "You're not on this team"}
          description={
            access?.member
              ? "Your access doesn't include changing what people can open. Ask the owner or a mentor or coach."
              : "Roles and permissions open for the owner and mentors of a team you're on."
          }
        >
          <Button as="a" variant="secondary" href={`/dashboard?orgId=${encodeURIComponent(orgId)}`}>
            Back to Home
          </Button>
        </EmptyState>
      </main>
    );
  }
  return (
    <main className="module-page team-admin-page">
      {header}
      <TeamPermissionsClient orgId={orgId} />
    </main>
  );
}
