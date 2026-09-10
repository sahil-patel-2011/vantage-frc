import { EmptyState, PageHeader } from "../../../components/ui";
import {
  FORM_BUILDER_RELATED_INCLUDE,
  formBuilderNextActions,
  formBuilderRelatedLinks,
  formBuilderSetupSteps,
  formBuilderShellCopy,
} from "../../../lib/scouting/form-builder";
import FormsClient from "./forms-client";
import "./forms.css";

export const metadata = {
  title: "Scouting form builder",
  description:
    "Build and publish custom match and pit scouting forms.",
};

export default async function ScoutingFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = formBuilderShellCopy("setup");
    const links = formBuilderRelatedLinks(null, {
      include: [...FORM_BUILDER_RELATED_INCLUDE],
    });
    const steps = formBuilderSetupSteps(null);
    const actions = formBuilderNextActions({ orgId: null, shell: "setup" });
    return (
      <main className="module-page sfb-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Form builder"
          title="Scouting form builder"
          description="Publish versioned match or pit schemas. Scouts and Coverage stay blank until a real version exists."
        >
          <nav className="product-hub-related sfb-related" aria-label="Related competition tools">
            {links.map((link) => (
              <a key={link.id} className="app-button secondary" href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        </PageHeader>
        <EmptyState
          soft
          className="sfb-shell-empty"
          badge="Setup required"
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          <a className="app-button" href="/workspace">
            Choose your team
          </a>
          <ol className="sfb-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
        <section
          className="app-card soft-panel edc-next-actions sfb-next-actions"
          aria-label="Next actions"
        >
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
                <a className="app-button secondary" href={action.href}>
                  Open
                </a>
              </li>
            ))}
          </ol>
        </section>
      </main>
    );
  }
  return <FormsClient orgId={orgId} />;
}
