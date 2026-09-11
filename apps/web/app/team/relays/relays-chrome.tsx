"use client";

import { type FormEvent, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel, Button, FormGrid, FormRow } from "../../../components/ui";
import {
  RELAYS_PAGE_DESCRIPTION,
  RELAYS_RELATED_INCLUDE,
  labelRelayRole,
  relaysRelatedLinks,
  relaysSetupSteps,
  relaysShellCopy,
  type RelayNode,
  type RelaysNextAction,
  type RelaysShellKind,
} from "../../../lib/relays/relays-related";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import { hubWorkbenchHref } from "../../../lib/nav/hubs";

export function RelaysRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = relaysRelatedLinks(orgId, {
    include: [...RELAYS_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related relays-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function RelaysNextActionsPanel({ actions }: { actions: RelaysNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions relays-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
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

export function RelaysPasteForm({
  token,
  name,
  busy,
  message,
  notice,
  onToken,
  onName,
  onSave,
}: {
  token: string;
  name: string;
  busy: boolean;
  message: string;
  notice: string;
  onToken: (value: string) => void;
  onName: (value: string) => void;
  onSave: (event: FormEvent) => void;
}) {
  return (
    <Panel id="relay-paste" aria-label="Paste the relay token">
      <form onSubmit={onSave}>
        <p>
          <strong>Paste the token from the Pi</strong>
        </p>
        <p className="app-muted">
          The installer prints a token. Paste it here. Never a Freebuff website cookie, a browser
          extension, or a bookmarklet.
        </p>
        <FormGrid>
          <FormRow label="Token from the Pi" hint="The short token the Pi prints — not a website cookie.">
            <input
              value={token}
              onChange={(event) => onToken(event.target.value)}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              required
            />
          </FormRow>
          <FormRow label="Name (optional)" hint="A shop name so the team can tell Pis apart.">
            <input
              value={name}
              onChange={(event) => onName(event.target.value)}
              placeholder="Shop Pi"
            />
          </FormRow>
        </FormGrid>
        <Button type="submit" variant="primary" disabled={busy || !token.trim()}>
          {busy ? "Saving…" : "Save this token"}
        </Button>
      </form>
      {notice ? <p>{notice}</p> : null}
      {message ? <p className="app-muted">{message}</p> : null}
    </Panel>
  );
}

export function RelaysNodeList({ nodes }: { nodes: RelayNode[] }) {
  if (!nodes.length) return null;
  return (
    <Panel aria-label="Paired Pis">
      <p>
        <strong>Paired Pis</strong>
      </p>
      <ul>
        {nodes.map((node) => (
          <li key={node.id}>
            <strong>{node.name}</strong>
            {" · "}
            {node.online ? "online" : "offline"}
            {node.roles.length
              ? ` · ${node.roles.map((role) => labelRelayRole(role)).join(", ")}`
              : ""}
            {node.instances ? ` · ${node.instances} instance${node.instances === 1 ? "" : "s"}` : ""}
            {node.queueDepth != null ? ` · queue ${node.queueDepth}` : ""}
            {node.tokensPerSecond ? ` · ${node.tokensPerSecond} tok/s` : ""}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function RelaysShell({
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: RelaysShellKind;
  error?: string;
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const copy = relaysShellCopy(shell);
  const chooseTeam = shell === "setup" && (errorStatus === 401 || errorStatus === 403 || !orgId);
  const setup = shell === "setup" ? relaysSetupSteps(chooseTeam ? null : orgId)[0] : null;
  const teamHref = hubWorkbenchHref("team", "team-relays", orgId);
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;

  return (
    <main className="module-page relays-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / AI relays"}
          </>
        }
        title="AI relays"
        description={RELAYS_PAGE_DESCRIPTION}
      >
        <RelaysRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        className="relays-empty"
        badge={failure ? undefined : copy.badge}
        badgeTone="setup"
        title={failure ? failure.title : chooseTeam ? "Choose your team" : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {shell === "error" && onRetry && (failure?.showRetry ?? true) ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}