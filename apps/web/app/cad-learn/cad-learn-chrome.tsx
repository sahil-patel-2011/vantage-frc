"use client";

import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  CAD_LEARN_PAGE_DESCRIPTION,
  CAD_LEARN_RELATED_INCLUDE,
  cadLearnNextActions,
  cadLearnRelatedLinks,
  cadLearnShellCopy,
  type CadLearnShellKind,
} from "../../lib/cad-learn/cad-learn-related";
import { withOrgHref } from "../../lib/nav/product-nav";

export function CadLearnRelated({ orgId }: { orgId?: string | null }) {
  const links = cadLearnRelatedLinks(orgId, { include: [...CAD_LEARN_RELATED_INCLUDE] });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related cad-related" aria-label="Related CAD tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function CadLearnHeader({ orgId }: { orgId?: string | null }) {
  return (
    <PageHeader
      breadcrumbs={
        <>
          <a href={withOrgHref("/build", orgId)}>Build</a>
          {" / Learn CAD"}
        </>
      }
      title="Learn CAD"
      description={CAD_LEARN_PAGE_DESCRIPTION}
    >
      <CadLearnRelated orgId={orgId} />
    </PageHeader>
  );
}

export function CadLearnEmptyCard({
  shell,
  onRetry,
}: {
  shell: CadLearnShellKind;
  onRetry?: () => void;
}) {
  const copy = cadLearnShellCopy(shell);
  return (
    <EmptyState
      soft
      badge={copy.badge}
      badgeTone="setup"
      title={copy.title}
      description={copy.description}
      aria-busy={shell === "loading"}
    >
      {shell === "setup" ? (
        <Button as="a" variant="primary" href="/workspace">
          Choose your team
        </Button>
      ) : null}
      {shell === "error" && onRetry ? (
        <Button variant="primary" type="button" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </EmptyState>
  );
}

export function CadLearnNextActions({
  orgId,
  firstUndoneId,
  remainingLessons,
}: {
  orgId?: string | null;
  firstUndoneId?: string | null;
  remainingLessons: number;
}) {
  const actions = cadLearnNextActions({ orgId, firstUndoneId, remainingLessons });
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions cad-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page or lesson where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
