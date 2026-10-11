"use client";

// Pick list chrome: the related-tools strip, next actions, and the setup / empty /
// error / loading shell shown before a desk is ready. The workbench owns the data.

import type { ReactNode } from "react";
import { EmptyState, Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import {
  PICK_DESK_RELATED_INCLUDE,
  pickDeskNextActions,
  pickDeskRelatedLinks,
  pickDeskSetupSteps,
  pickDeskShellCopy,
  type PickDeskNextAction,
  type PickDeskShellKind,
} from "../../lib/strategy/pick-desk-related";

export function PickDeskRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = pickDeskRelatedLinks(orgId, {
    include: [...PICK_DESK_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related pick-desk-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function PickDeskNextActionsPanel({ actions }: { actions: PickDeskNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions pick-desk-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PickDeskShell({
  orgId,
  shell,
  error,
  onRetry,
  embedded,
  children,
}: {
  orgId?: string | null;
  shell: PickDeskShellKind;
  error?: string;
  onRetry?: () => void;
  embedded?: boolean;
  children?: ReactNode;
}) {
  const actions = pickDeskNextActions({ orgId, shell });
  const copy = pickDeskShellCopy(shell, orgId);
  const setup = shell === "setup" ? pickDeskSetupSteps(orgId)[0] : null;
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  return (
    <section
      className={`strategy-pick-desk pick-desk-workbench soft-gate${embedded ? " embedded" : ""}`}
      aria-label="Pick list setup"
    >
      <header className="pick-desk-heading">
        <div>
          <h2 style={{ marginTop: 0 }}>Pick list</h2>
          <p className="app-muted">
            Order robots by tier, then save your list.
          </p>
        </div>
        <PickDeskRelatedStrip orgId={orgId} />
      </header>
      {children}
      <EmptyState
        soft
        className="pick-desk-empty"
        badge={
          shell === "setup"
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No teams yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={scoutingHref}>
            Open Scouting
          </Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <PickDeskNextActionsPanel actions={actions} /> : null}
    </section>
  );
}
