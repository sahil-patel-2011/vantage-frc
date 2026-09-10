"use client";

import { Button } from "../../../components/ui";
import {
  aiKeysRelatedLinks,
  aiKeysShellCopy,
  AI_KEYS_RELATED_INCLUDE,
  type AiKeysShellKind,
} from "../../../lib/ai-keys/ai-keys-related";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";

export function RelatedStrip({ orgId }: { orgId: string }) {
  const links = aiKeysRelatedLinks(orgId, { include: [...AI_KEYS_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related ai-keys-related" aria-label="Related AI settings">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function ShellPanel({
  shell,
  detail,
  orgId,
}: {
  shell: AiKeysShellKind;
  detail?: string | null;
  orgId: string | null;
}) {
  const copy = aiKeysShellCopy(shell, detail);
  return (
    <section className="app-card soft-panel ai-keys-shell" role="status">
      {copy.badge ? <span className="app-badge setup">{copy.badge}</span> : null}
      <span className="eyebrow">{copy.eyebrow}</span>
      <h2>{copy.title}</h2>
      <p className="app-muted">{copy.description}</p>
      {shell === "empty" ? (
        <Button as="a" variant="primary" href="/workspace">Choose your team</Button>
      ) : null}
      {shell === "auth_required" ? (
        <Button as="a" variant="primary"
          href={`/signin?next=${encodeURIComponent("/team/ai-keys")}`}
        >
          Sign in
        </Button>
      ) : null}
      {shell === "setup" && orgId ? (
        <Button as="a" variant="secondary" href={withOrgHref("/team/admin", orgId)}>
          Team admin
        </Button>
      ) : null}
    </section>
  );
}

/**
 * The load failed — say why, and offer the one action that fixes it. Retry can
 * never revive an expired session, so an auth failure offers sign-in instead.
 */
export function LoadFailurePanel({
  status,
  message,
  onRetry,
}: {
  status: number | null;
  message: string;
  onRetry: () => void;
}) {
  const kind = classifyLoadFailure({
    status,
    message,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
  });
  const copy = loadFailureCopy(kind, {
    nextPath:
      typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
    message,
  });
  const badge =
    kind === "auth"
      ? "Signed out"
      : kind === "forbidden"
        ? "No access"
        : kind === "offline"
          ? "Offline"
          : "Error";
  return (
    <section className="app-card soft-panel ai-keys-shell" role="status">
      <span className="app-badge setup">{badge}</span>
      <span className="eyebrow">{badge.toUpperCase()}</span>
      <h2>{copy.title}</h2>
      <p className="app-muted">{copy.description}</p>
      {copy.primary ? (
        <Button as="a" variant="primary" href={copy.primary.href}>
          {copy.primary.label}
        </Button>
      ) : null}
      {copy.showRetry ? (
        <Button variant="secondary" type="button" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </section>
  );
}
