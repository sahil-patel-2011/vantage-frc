import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import {
  TEAM_ADMIN_RELATED_INCLUDE,
  teamAdminRelatedLinks,
  teamAdminSetupSteps,
  teamAdminShellCopy,
} from "../../../lib/team/team-admin-related";
import { withOrgHref } from "../../../lib/nav/product-nav";
import TeamAdminClient from "../team-admin-client";
import { RoleProfilesPanel } from "../role-profiles-panel";
import "../team-admin.css";

export const metadata = {
  title: "Team admin",
  description:
    "Invite teammates by exact email. People without an invite go to the waitlist.",
};

export default async function TeamAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = teamAdminShellCopy("setup");
    const setup = teamAdminSetupSteps(null)[0];
    const related = teamAdminRelatedLinks(null, {
      include: [...TEAM_ADMIN_RELATED_INCLUDE],
    });
    return (
      <main className="module-page team-admin-page soft-gate">
        <PageHeader
          breadcrumbs="Team / Admin"
          title="Team admin"
          description="Invite teammates by exact email. People without an invite go to the waitlist."
        >
          <nav className="product-hub-related team-admin-related" aria-label="Related account tools">
            {related.map((link) => (
              <a key={link.id} href={link.href}>{link.label}</a>
            ))}
          </nav>
        </PageHeader>
        <TeamOpsNav active="admin" />
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
        <p className="app-muted" style={{ marginTop: "1rem" }}>
          After you choose your team, open{" "}
          <a href={withOrgHref("/team/admin", null)}>Team admin</a> again to invite people by exact email.
        </p>
      </main>
    );
  }
  return (
    <>
      <TeamAdminClient orgId={orgId} />
      {/* The named jobs sit under the member editor: you read "who is on the
          team" first, then hand out a role. */}
      <div className="module-page team-admin-page">
        <RoleProfilesPanel orgId={orgId} />
        <p className="app-muted team-admin-moderation-link">
          <a href={withOrgHref("/messages/moderation", orgId)}>Chat moderation</a> — review team chat messages
          members have reported, and remove ones that break team rules.
        </p>
      </div>
    </>
  );
}
