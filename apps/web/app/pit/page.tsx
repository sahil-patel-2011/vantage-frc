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
  title: "Pit Command",
  description:
    "Is the robot ready to play? Open repairs, maintenance, and batteries from what your team logged.",
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
              {" / Pit / Robot status"}
            </>
          }
          title="Robot status"
          description={copy.description}
        >
          {related.length ? (
            <nav className="product-hub-related pit-related" aria-label="Related pit tools">
              {related.map((link) => (
                <a key={link.id} href={link.href}>{link.label}</a>
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
