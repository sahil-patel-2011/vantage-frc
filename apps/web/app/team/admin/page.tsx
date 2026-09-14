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
import "../team-admin.css";

export const metadata = {
  title: "Invites",
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
          breadcrumbs="Team / Invites"
          title="Invites"
          description="Invite teammates by exact email. People without an invite go to the waitlist."
        >
          <nav className="product-hub-related team-admin-related" aria-label="Related account tools">
            {related.map((link) => (
              <Button as="a" variant="secondary" key={link.id} href={link.href}>
                {link.label}
              </Button>
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
          <a href={withOrgHref("/team/admin", null)}>Invites</a> again to invite people by exact email.
        </p>
      </main>
    );
  }
  return <TeamAdminClient orgId={orgId} />;
}
