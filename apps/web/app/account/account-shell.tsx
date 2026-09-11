"use client";

import { EmptyState, Panel, Button } from "../../components/ui";
import {
  ACCOUNT_RELATED_INCLUDE,
  accountNextActions,
  accountRelatedLinks,
  formatAccountOrgLabel,
  formatAccountRole,
} from "../../lib/account";
import type { OrgContext } from "./account-types";

export function AccountRelated({ orgId }: { orgId: string | null }) {
  const links = accountRelatedLinks(orgId, { include: [...ACCOUNT_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related account-related" aria-label="Related account tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function NextActions({
  orgId,
  hasProfile,
  emailDeliveryReady,
  googleReady,
  tbaReady,
}: {
  orgId: string | null;
  hasProfile: boolean;
  emailDeliveryReady: boolean;
  googleReady: boolean;
  tbaReady: boolean;
}) {
  const actions = accountNextActions({
    orgId,
    hasProfile,
    emailDeliveryReady,
    googleReady,
    tbaReady,
  });
  return (
    <section className="account-next-actions app-card soft-panel" aria-label="Next actions">
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

export function OrgContextCard({ org }: { org: OrgContext }) {
  const label = formatAccountOrgLabel(org);
  const role = formatAccountRole(org.role);

  if (!org.orgId) {
    return (
      <EmptyState
        soft
        badge="Needs setup"
        badgeTone="setup"
        title="Choose your team"
        description={
          org.workspaceCount > 0
            ? "Your profile prefs still apply to this login. Choose your team for billing, AI usage, and connectors."
            : "You are signed in, but you are not on a team yet. Ask an owner to send you an invite."
        }
      >
        <Button as="a" variant="primary" href="/workspace">
          Choose your team
        </Button>
      </EmptyState>
    );
  }

  return (
    <Panel className="account-org-context" aria-label="This team">
      <div className="account-org-context-top">
        <div>
          <h2>This team</h2>
          <p>{label}</p>
        </div>
        <div className="account-org-meta">
          {role ? <span className="app-badge">{role}</span> : null}
          {org.planCode?.trim() ? (
            <span className="app-badge good">{org.planCode.trim()}</span>
          ) : (
            <span className="app-badge setup">No plan yet</span>
          )}
        </div>
      </div>
      <p className="app-muted">
        Display name and notification prefs are personal. AI keys, billing, and connectors follow this team.
      </p>
      {/* AI keys / Billing / AI usage are exactly the related strip above this
          panel, same hrefs in the same order. What belongs here is the one link
          that is actually about the *active* workspace. */}
      <div className="settings-inline-links">
        <a href="/workspace">Switch team</a>
      </div>
    </Panel>
  );
}
