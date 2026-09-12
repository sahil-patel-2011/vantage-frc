import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  SCOUT_CROSSVAL_RELATED_INCLUDE,
  scoutCrossvalRelatedLinks,
  scoutCrossvalSetupSteps,
  scoutCrossvalShellCopy,
} from "../../lib/scout-crossval/scout-crossval-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import ScoutCrossvalClient from "./scout-crossval-client";
import "./scout-crossval.css";

export const metadata = {
  title: "Cross-check",
};

export default async function ScoutCrossvalPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = scoutCrossvalShellCopy("setup");
    const related = scoutCrossvalRelatedLinks(null, {
      include: [...SCOUT_CROSSVAL_RELATED_INCLUDE],
    });
    const setup = scoutCrossvalSetupSteps(null)[0];
    return (
      <main className="module-page scout-crossval-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Cross-check"
          title="Cross-check"
          description={copy.description}
        >
          <nav className="product-hub-related scout-crossval-related" aria-label="Related competition tools">
            {related.map((link) => (
              <Button as="a" variant="secondary" key={link.id} href={link.href}>
                {link.label}
              </Button>
            ))}
          </nav>
        </PageHeader>
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          <Button as="a" variant="primary" href={setup?.href ?? "/workspace"}>
            {setup?.label ?? "Choose your team"}
          </Button>
        </EmptyState>
        <p className="app-muted scout-crossval-footer-links">
          Also see <a href={withOrgHref("/scout-coverage-live", null)}>Coverage</a>
        </p>
      </main>
    );
  }
  return <ScoutCrossvalClient orgId={orgId} />;
}
