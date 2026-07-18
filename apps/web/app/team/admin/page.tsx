import { EmptyState, PageHeader } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import { githubSetupSteps, githubShellCopy } from "../../../lib/github/github-related";
import TeamAdminClient from "../team-admin-client";

export const metadata = {
  title: "Team admin · Vantage",
  description:
    "Membership, invites, GitHub robot-code context, and provider settings — never DEMO repositories.",
};

export default async function TeamAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = githubShellCopy("setup");
    const steps = githubSetupSteps(null);
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Admin"
          title="Team admin"
          description="Membership, invites, and GitHub context are org-scoped. Choose a team workspace to continue — nothing is pre-seeded."
        />
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
        <section className="app-card soft-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Workspace first — GitHub PAT, Code Coach, and Pair VS Code after.</p>
          </header>
          <ul className="github-setup-steps" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {steps.map((step) => (
              <li
                key={step.id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                  justifyContent: "space-between",
                  padding: "0.75rem 0",
                }}
              >
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    );
  }
  return <TeamAdminClient orgId={orgId} />;
}
