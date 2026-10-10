import { EmptyState, PageHeader, Button } from "../../../components/ui";
import {
  LINEUP_RELATED_INCLUDE,
  lineupRelatedLinks,
  lineupSetupSteps,
  lineupShellCopy,
} from "../../../lib/scouting/lineup-related";
import LineupClient from "./lineup-client";
import "./lineup.css";

export const metadata = {
  title: "Scouting assignments",
};

export default async function ScoutingLineupPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; eventKey?: string; matchKey?: string; qualsOnly?: string }>;
}) {
  const { orgId, eventKey, matchKey, qualsOnly } = await searchParams;
  if (!orgId) {
    const copy = lineupShellCopy("setup");
    const related = lineupRelatedLinks(null, { include: [...LINEUP_RELATED_INCLUDE] });
    const setup = lineupSetupSteps(null)[0];
    return (
      <main className="module-page lineup-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Assignments"
          title="Assignments"
          description={copy.description}
        >
          <nav className="product-hub-related lineup-related" aria-label="Related competition tools">
            {related.map((link) => (
              <a key={link.id} href={link.href}>{link.label}</a>
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
      </main>
    );
  }
  return <LineupClient key={`${orgId}:${eventKey ?? "active"}:${matchKey ?? ""}:${qualsOnly ?? "1"}`} orgId={orgId} eventKey={eventKey} initialMatchKey={matchKey} initialQualsOnly={qualsOnly !== "0" && qualsOnly !== "false"} />;
}
