import { EmptyState, PageHeader, Button } from "../../../components/ui";
import {
  LINEUP_RELATED_INCLUDE,
  lineupRelatedLinks,
  lineupSetupSteps,
  lineupShellCopy,
} from "../../../lib/scouting/lineup-related";
import { withOrgHref } from "../../../lib/nav/product-nav";
import LineupClient from "./lineup-client";
import "./lineup.css";

export const metadata = {
  title: "Lineup & coverage",
};

export default async function ScoutingLineupPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = lineupShellCopy("setup");
    const related = lineupRelatedLinks(null, { include: [...LINEUP_RELATED_INCLUDE] });
    const setup = lineupSetupSteps(null)[0];
    return (
      <main className="module-page lineup-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Lineup & coverage"
          title="Lineup & coverage"
          description={copy.description}
        >
          <nav className="product-hub-related lineup-related" aria-label="Related competition tools">
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
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
        </EmptyState>
        <p className="app-muted lineup-footer-links">
          Also see <a href={withOrgHref("/scout-coverage-live", null)}>Scout Coverage Live</a>
        </p>
      </main>
    );
  }
  return <LineupClient orgId={orgId} />;
}
