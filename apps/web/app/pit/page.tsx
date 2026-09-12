import type { Metadata } from "next";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  PIT_RELATED_INCLUDE,
  pitRelatedLinks,
  pitShellCopy,
} from "../../lib/pit/pit-related";
import "./pit-command.css";
import PitCommandClient from "./pit-command-client";

export const metadata: Metadata = {
  title: "Pit Command — Vantage",
  description:
    "Robot release board from logged issues, maintenance, and battery evidence. Links to Batteries, Match checklist, and Event day.",
};

export default async function PitCommandPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = pitShellCopy("setup");
    const related = pitRelatedLinks(null, { include: [...PIT_RELATED_INCLUDE] });
    return (
      <main className="module-page pit-page soft-gate">
        <PageHeader
          breadcrumbs={
            <>
              <a href="/competition">Competition</a>
              {" / Pit command"}
            </>
          }
          title="Pit command"
          description={copy.description}
        >
          {related.length ? (
            <nav className="product-hub-related pit-related" aria-label="Related pit tools">
              {related.map((link) => (
                <Button as="a" variant="secondary" key={link.id} href={link.href}>
                  {link.label}
                </Button>
              ))}
            </nav>
          ) : null}
        </PageHeader>
        <EmptyState
          soft
          badge={copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  return <PitCommandClient orgId={orgId} />;
}
