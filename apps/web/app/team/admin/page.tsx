import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { teamAdminShellCopy, teamAdminSetupSteps } from "../../../lib/team/team-admin-related";
import TeamAdminClient from "../team-admin-client";
import { SuggestInvite } from "../suggest-invite";
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
          title="Members and invites"
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
  const access = session ? await withRls({ userId: session.user.id, orgId }, async client =>
    (await client.query<{ allowed: boolean; member: boolean }>(
      "SELECT has_org_capability($1::uuid,'manage_members') AS allowed, is_org_member($1::uuid) AS member",
      [orgId],
    )).rows[0] ?? null,
  ) : null;
  // A student or parent: say who does this, and let them ask (QA A3-04, A3-22). The page used to
  // say only "Team administrator access required", and the request reached nobody.
  if (!access?.allowed) return (
    <main className="module-page team-admin-page soft-gate">
      <PageHeader title="Members and invites" description="Manage your team's people and invitations." />
      <EmptyState
        title={access?.member ? "The team owner and mentors manage people" : "You're not on this team"}
        description={
          access?.member
            ? "Your access doesn't include inviting people or changing what they can do. You can ask the owner and mentors to invite someone below."
            : "Team admin opens for the owner and mentors of a team you're on."
        }
      >
        <Button as="a" variant="secondary" href={`/dashboard?orgId=${encodeURIComponent(orgId)}`}>Back to Home</Button>
      </EmptyState>
      {access?.member ? <SuggestInvite orgId={orgId} /> : null}
    </main>
  );
  return <TeamAdminClient orgId={orgId} />;
}
