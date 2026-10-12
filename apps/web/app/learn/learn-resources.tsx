import { Button, PageHeader } from "../../components/ui";
import { LEARN_PAGE_DESCRIPTION, LEARN_RESOURCE_CARDS } from "../../lib/learn/resources";
import { withOrgHref } from "../../lib/nav/product-nav";

export function LearnResources() {
  return (
    <main className="module-page learn-resources-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={withOrgHref("/build", null)}>Build</a>
            {" / Learn"}
          </>
        }
        title="Learn"
        description={LEARN_PAGE_DESCRIPTION}
      >
        <nav className="product-hub-related" aria-label="Related build tools">
          <a href={withOrgHref("/cad-learn", null)}>Learn CAD</a>
          <a href={withOrgHref("/dev-setup", null)}>Programming setup</a>
        </nav>
      </PageHeader>

      <ul className="learn-resource-grid">
        {LEARN_RESOURCE_CARDS.map((card) => (
          <li key={card.id} className="learn-resource-card" id={card.id}>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
            {/* The checked tracks are where to start (A5-27): the page's one primary. */}
            <Button as="a" variant={card.id === "guided" ? "primary" : "secondary"} href={withOrgHref(card.href, null)}>
              {card.primary}
            </Button>
          </li>
        ))}
      </ul>
    </main>
  );
}
