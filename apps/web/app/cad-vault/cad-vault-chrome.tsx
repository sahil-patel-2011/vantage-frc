"use client";

import { type ReactNode } from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  CAD_VAULT_RELATED_INCLUDE,
  cadVaultNextActions,
  cadVaultRelatedLinks,
  cadVaultShellCopy,
  type CadVaultNextAction,
  type CadVaultShellKind,
} from "../../lib/cad-vault/cad-vault-related";
import { withOrgHref } from "../../lib/nav/product-nav";

export const CAD_VAULT_DESCRIPTION =
  "Live Onshape and Fusion links first, then printable STL or STEP files. Titles are the names the team searches.";

export function CadVaultRelated({ orgId }: { orgId?: string | null }) {
  const links = cadVaultRelatedLinks(orgId, { include: [...CAD_VAULT_RELATED_INCLUDE] });
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

export function CadVaultNextActions({
  orgId,
  shell,
  documentCount,
  linkedCount,
}: {
  orgId?: string | null;
  shell: CadVaultShellKind;
  documentCount: number;
  linkedCount: number;
}) {
  const actions = cadVaultNextActions({ orgId, shell, documentCount, linkedCount });
  return <CadVaultNextActionsPanel actions={actions} />;
}

export function CadVaultNextActionsPanel({ actions }: { actions: CadVaultNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions cad-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
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

export function CadVaultHeader({
  orgId,
  description,
  children,
}: {
  orgId?: string | null;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <PageHeader
      breadcrumbs={
        <>
          <a href={withOrgHref("/build", orgId)}>Build</a>
          {" / CAD vault"}
        </>
      }
      title="CAD vault"
      description={description ?? CAD_VAULT_DESCRIPTION}
    >
      <CadVaultRelated orgId={orgId} />
      {children}
    </PageHeader>
  );
}

export function CadVaultEmptyCard({
  shell,
  description,
  primaryHref,
  primaryLabel,
  onRetry,
}: {
  shell: CadVaultShellKind;
  description?: string;
  primaryHref?: string;
  primaryLabel?: string;
  onRetry?: () => void;
}) {
  const copy = cadVaultShellCopy(shell);
  const href = primaryHref ?? (shell === "setup" ? "/workspace" : shell === "empty" ? "#link-cad" : undefined);
  const label =
    primaryLabel ??
    (shell === "setup" ? "Choose your team" : shell === "empty" ? "Link a CAD document" : undefined);
  return (
    <EmptyState
      soft
      badge={copy.badge}
      badgeTone="setup"
      title={copy.title}
      description={description ?? copy.description}
      aria-busy={shell === "loading"}
    >
      {href && label && shell !== "error" ? (
        <Button as="a" variant="primary" href={href}>
          {label}
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
