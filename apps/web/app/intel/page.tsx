import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  INTEL_RELATED_INCLUDE,
  intelRelatedLinks,
  intelSetupSteps,
  intelShellCopy,
} from "../../lib/intel/intel-related";
import IntelClient from "./intel-client";
import "./intel.css";

export const metadata = {
  title: "Research",
};

export default async function IntelPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = intelShellCopy("setup");
    const setup = intelSetupSteps(null)[0];
    const links = intelRelatedLinks(null, { include: [...INTEL_RELATED_INCLUDE] });
    return (
      <main className="module-page intel-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Research"
          title="Research"
          description={copy.description}
        >
          <nav className="product-hub-related intel-related" aria-label="Related competition tools">
            {links.map((link) => (
              <Button as="a" variant="secondary" key={link.id} href={link.href}>
                {link.label}
              </Button>
            ))}
          </nav>
        </PageHeader>
        <EmptyState soft badge={copy.badge} badgeTone="setup" title={copy.title} description={copy.description}>
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }
  return <IntelClient orgId={orgId} />;
}
