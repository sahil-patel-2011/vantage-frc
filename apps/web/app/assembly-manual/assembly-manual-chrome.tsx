"use client";

import { EmptyState, Button } from "../../components/ui";
import {
  ASSEMBLY_MANUAL_RELATED_INCLUDE,
  CONNECT_ONSHAPE,
  assemblyManualRelatedLinks,
  assemblyManualShellCopy,
  type AssemblyManualShellKind,
} from "../../lib/assembly-manual/assembly-manual-related";
import { ONSHAPE_OAUTH_CTA } from "../../lib/cad/onshape-setup-strings";
import { withOrgHref } from "../../lib/nav/product-nav";

export function AssemblyManualRelated({ orgId }: { orgId?: string | null }) {
  const links = assemblyManualRelatedLinks(orgId, { include: [...ASSEMBLY_MANUAL_RELATED_INCLUDE] });
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

export function AssemblyManualEmptyCard({
  shell,
  description,
  onRetry,
}: {
  shell: AssemblyManualShellKind;
  description?: string;
  onRetry?: () => void;
}) {
  const copy = assemblyManualShellCopy(shell);
  return (
    <EmptyState
      soft
      badge={copy.badge}
      badgeTone="setup"
      title={copy.title}
      description={description ?? copy.description}
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

export function ConnectOnshapeCard({
  orgId,
  configured,
  message,
}: {
  orgId?: string | null;
  configured: boolean;
  message: string;
}) {
  return (
    <EmptyState
      soft
      badge="Needs setup"
      badgeTone="setup"
      title={configured ? CONNECT_ONSHAPE : ONSHAPE_OAUTH_CTA.disabledTitle}
      description={
        configured
          ? message || "Connect Onshape in the browser, then paste your assembly link to start the book."
          : ONSHAPE_OAUTH_CTA.disabledDetail
      }
    >
      {configured ? (
        <Button as="a" variant="primary" href={withOrgHref("/cad/connections", orgId)}>
          {CONNECT_ONSHAPE}
        </Button>
      ) : null}
    </EmptyState>
  );
}
