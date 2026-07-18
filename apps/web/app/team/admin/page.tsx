import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import {
  TEAM_ADMIN_RELATED_INCLUDE,
  teamAdminNextActions,
  teamAdminRelatedLinks,
  teamAdminSetupSteps,
  teamAdminShellCopy,
} from "../../../lib/team/team-admin-related";
import { withOrgHref } from "../../../lib/nav/product-nav";
import TeamAdminClient from "../team-admin-client";
import "../team-admin.css";

export const metadata = {
  title: "Team admin · Vantage",
  description:
    "Membership, invites, GitHub robot-code context, and provider settings — never DEMO members or repositories.",
};

export default async function TeamAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = teamAdminShellCopy("setup");
    const steps = teamAdminSetupSteps(null);
    const related = teamAdminRelatedLinks(null, {
      include: [...TEAM_ADMIN_RELATED_INCLUDE],
    });
    const actions = teamAdminNextActions({ orgId: null, shell: "setup" });
    return (
      <main className="module-page team-admin-page soft-gate">
        <PageHeader
          breadcrumbs="Team / Admin"
          title="Team admin"
          description="Membership, invites, and GitHub context are org-scoped. Choose a team workspace to continue — nothing is pre-seeded as DEMO members."
        >
          <nav className="product-hub-related team-admin-related" aria-label="Related account tools">
            {related.map((link) => (
              <a key={link.id} className="app-button secondary" href={link.href}>
                {link.label}
              </a>
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
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
        </EmptyState>
        <Panel className="team-admin-membership" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Workspace first — invite, Discord, and Connections after. Never DEMO members.</p>
          </header>
          <ul className="team-admin-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted team-admin-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
        <section className="app-card soft-panel team-admin-next-actions" aria-label="Next actions">
          <header>
            <h2>Next actions</h2>
            <p className="app-muted">Account, Discord, and Connections — never DEMO members.</p>
          </header>
          <ol>
            {actions.map((action) => (
              <li key={action.id} className={action.primary ? "primary" : undefined}>
                <div>
                  <strong>{action.label}</strong>
                  <span>{action.detail}</span>
                </div>
                <a className="app-button secondary" href={action.href}>
                  Open
                </a>
              </li>
            ))}
          </ol>
        </section>
        <p className="app-muted" style={{ marginTop: "1rem" }}>
          After you pick a workspace, open{" "}
          <a href={withOrgHref("/team/admin", null)}>Team admin</a> again to manage real members and invites.
        </p>
      </main>
    );
  }
  return <TeamAdminClient orgId={orgId} />;
}
