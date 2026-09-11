import { EmptyState, Button, PageHeader } from "../../../components/ui";
import { ALUMNI_RELATED_INCLUDE, alumniRelatedLinks, alumniShellCopy } from "../../../lib/alumni";
import AlumniClient from "./alumni-client";

export const metadata = {
  title: "Alumni · Team",
};

export default async function TeamAlumniPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = alumniShellCopy("setup");
    const related = alumniRelatedLinks(null, { include: [...ALUMNI_RELATED_INCLUDE] });
    return (
      <main className="content">
        <PageHeader title="Alumni" description={copy.description}>
          {related.length ? (
            <nav className="product-hub-related" aria-label="Related team tools">
              {related.map((link) => (
                <Button as="a" variant="secondary" key={link.id} href={link.href}>
                  {link.label}
                </Button>
              ))}
            </nav>
          ) : null}
        </PageHeader>
        <EmptyState badge={copy.badge} badgeTone="setup" title={copy.title} description={copy.description}>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <AlumniClient orgId={orgId} />;
}
