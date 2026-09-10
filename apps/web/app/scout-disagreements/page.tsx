import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  SCOUT_DISAGREEMENTS_RELATED_INCLUDE,
  scoutDisagreementsRelatedLinks,
  scoutDisagreementsSetupSteps,
  scoutDisagreementsShellCopy,
} from "../../lib/scout-disagreements/scout-disagreements-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import ScoutDisagreementsClient from "./scout-disagreements-client";
import "./scout-disagreements.css";

export const metadata = {
  title: "Scout Disagreements",
};

export default async function ScoutDisagreementsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = scoutDisagreementsShellCopy("setup");
    const related = scoutDisagreementsRelatedLinks(null, {
      include: [...SCOUT_DISAGREEMENTS_RELATED_INCLUDE],
    });
    const setup = scoutDisagreementsSetupSteps(null)[0];
    return (
      <main className="module-page scout-disagreements-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Scout Disagreements"
          title="Scout Disagreements"
          description={copy.description}
        >
          <nav
            className="product-hub-related scout-disagreements-related"
            aria-label="Related competition tools"
          >
            {related.map((link) => (
              <Button as="a" variant="secondary" key={link.id} href={link.href}>
                {link.label}
              </Button>
            ))}
          </nav>
        </PageHeader>
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          <Button as="a" variant="primary" href={setup?.href ?? "/workspace"}>
            {setup?.label ?? "Choose your team"}
          </Button>
        </EmptyState>
        <p className="app-muted scout-disagreements-footer-links">
          Also see <a href={withOrgHref("/scout-accuracy", null)}>Accuracy</a>
          {" · "}
          <a href={withOrgHref("/scouting/lineup", null)}>Coverage</a>
        </p>
      </main>
    );
  }
  return <ScoutDisagreementsClient orgId={orgId} />;
}
