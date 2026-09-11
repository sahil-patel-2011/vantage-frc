import { EmptyState, PageHeader, Button } from "../../../components/ui";
import {
  FORM_BUILDER_RELATED_INCLUDE,
  formBuilderRelatedLinks,
  formBuilderShellCopy,
} from "../../../lib/scouting/form-builder";
import FormsClient from "./forms-client";
import "./forms.css";

export const metadata = {
  title: "Scouting form builder",
  description:
    "Build and publish custom match and pit schemas. Scouts and Coverage stay blank until a real version exists.",
};

export default async function ScoutingFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = formBuilderShellCopy("setup");
    const links = formBuilderRelatedLinks(null, {
      include: [...FORM_BUILDER_RELATED_INCLUDE],
    });
    return (
      <main className="module-page sfb-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Form builder"
          title="Scouting form builder"
          description="Publish versioned match or pit schemas. Scouts and Coverage stay blank until a real version exists."
        >
          <nav className="product-hub-related sfb-related" aria-label="Related competition tools">
            {links.map((link) => (
              <Button as="a" variant="secondary" key={link.id} href={link.href}>
                {link.label}
              </Button>
            ))}
          </nav>
        </PageHeader>
        <EmptyState
          soft
          className="sfb-shell-empty"
          badge="Needs setup"
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
  return <FormsClient orgId={orgId} />;
}
