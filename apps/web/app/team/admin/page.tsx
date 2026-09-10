import { EmptyState, PageHeader, Panel, Button } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import {
  TEAM_ADMIN_RELATED_INCLUDE,
  teamAdminCardPrimaryHref,
  teamAdminNextActions,
  teamAdminRelatedLinks,
  teamAdminSetupSteps,
  teamAdminShellCopy,
} from "../../../lib/team/team-admin-related";
import { withOrgHref } from "../../../lib/nav/product-nav";
import TeamAdminClient from "../team-admin-client";
import "../team-admin.css";

export const metadata = {
  title: "Team admin",
  description:
    "Membership, invites, GitHub robot-code context, and provider settings.",
};

export default async function TeamAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = teamAdminShellCopy("setup");
    const cardPrimaryHref = teamAdminCardPrimaryHref(null);
    const steps = teamAdminSetupSteps(null).filter((step) => step.href !== cardPrimaryHref);
    const related = teamAdminRelatedLinks(null, {
      include: [...TEAM_ADMIN_RELATED_INCLUDE],
    });
    const actions = teamAdminNextActions({ orgId: null, shell: "setup" }).filter(
      (action) => action.href !== cardPrimaryHref,
    );
    return (
      <main className="module-page team-admin-page soft-gate">
        <PageHeader
          breadcrumbs="Team / Admin"
          title="Team admin"
          description="Membership, invites, and GitHub context belong to one team. Choose a team to continue."
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
          badge="Setup required"
          badgeTone="setup"
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
        {steps.length > 0 ? (
          <Panel className="team-admin-membership" aria-label="Setup steps">
            <header>
              <h2>Setup steps</h2>
              <p className="app-muted">Finish these once and this page fills in.</p>
            </header>
            <ul className="team-admin-setup-steps">
              {steps.map((step) => (
                <li key={step.id}>
                  <div>
                    <strong>{step.label}</strong>
                    <p className="app-muted team-admin-tip">{step.detail}</p>
                  </div>
                  <Button as="a" variant="secondary" href={step.href}>
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
        {actions.length > 0 ? (
          <section className="app-card soft-panel team-admin-next-actions" aria-label="Next actions">
            <header>
              <h2>Next actions</h2>
              <p className="app-muted">Each one opens the page where you finish the work.</p>
            </header>
            <ol>
              {actions.map((action) => (
                <li key={action.id} className={action.primary ? "primary" : undefined}>
                  <div>
                    <strong>{action.label}</strong>
                    <span>{action.detail}</span>
                  </div>
                  <Button as="a" variant="secondary" href={action.href}>
                    Open
                  </Button>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <p className="app-muted" style={{ marginTop: "1rem" }}>
          After you pick a team, open{" "}
          <a href={withOrgHref("/team/admin", null)}>Team admin</a> again to manage real members and invites.
        </p>
      </main>
    );
  }
  return <TeamAdminClient orgId={orgId} />;
}
