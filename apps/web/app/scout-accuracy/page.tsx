import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  SCOUT_ACCURACY_RELATED_INCLUDE,
  scoutAccuracyRelatedLinks,
  scoutAccuracySetupSteps,
  scoutAccuracyShellCopy,
} from "../../lib/scout-accuracy/scout-accuracy-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import ScoutAccuracyClient from "./scout-accuracy-client";
import "./scout-accuracy.css";

export const metadata = {
  title: "Accuracy",
};

export default async function ScoutAccuracyPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = scoutAccuracyShellCopy("setup");
    const related = scoutAccuracyRelatedLinks(null, {
      include: [...SCOUT_ACCURACY_RELATED_INCLUDE],
    });
    const setup = scoutAccuracySetupSteps(null)[0];
    return (
      <main className="module-page scout-accuracy-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Accuracy"
          title="Accuracy"
          description={copy.description}
        >
          <nav
            className="product-hub-related scout-accuracy-related"
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
          badge="Needs setup"
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          <Button as="a" variant="primary" href={setup?.href ?? "/workspace"}>
            {setup?.label ?? "Choose your team"}
          </Button>
        </EmptyState>
        <p className="app-muted scout-accuracy-footer-links">
          Also see <a href={withOrgHref("/scouting/lineup", null)}>Coverage</a>
        </p>
      </main>
    );
  }
  return <ScoutAccuracyClient orgId={orgId} />;
}
