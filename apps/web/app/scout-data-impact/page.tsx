import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  SCOUT_DATA_IMPACT_RELATED_INCLUDE,
  scoutDataImpactRelatedLinks,
  scoutDataImpactSetupSteps,
  scoutDataImpactShellCopy,
} from "../../lib/scout-data-impact/scout-data-impact-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import ScoutDataImpactClient from "./scout-data-impact-client";
import "./scout-data-impact.css";

export const metadata = {
  title: "Scout Data Impact",
};

export default async function ScoutDataImpactPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = scoutDataImpactShellCopy("setup");
    const related = scoutDataImpactRelatedLinks(null, {
      include: [...SCOUT_DATA_IMPACT_RELATED_INCLUDE],
    });
    const setup = scoutDataImpactSetupSteps(null)[0];
    return (
      <main className="module-page scout-data-impact-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Scout Data Impact"
          title="Scout Data Impact"
          description={copy.description}
        >
          <nav
            className="product-hub-related scout-data-impact-related"
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
        <p className="app-muted scout-data-impact-footer-links">
          Also see <a href={withOrgHref("/scout-accuracy", null)}>Accuracy</a>
        </p>
      </main>
    );
  }
  return <ScoutDataImpactClient orgId={orgId} />;
}
