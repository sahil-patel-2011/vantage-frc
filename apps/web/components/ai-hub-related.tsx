"use client";

import { hubHref } from "../lib/nav/hubs";
import { withOrgHref } from "../lib/nav/product-nav";

const AI_TABS = [
  { id: "chat", label: "Chat" },
  { id: "budgets", label: "Budgets" },
  { id: "writer", label: "Writer" },
  { id: "code", label: "Code assist" },
  { id: "memory", label: "Memory" },
  { id: "governance", label: "Governance" },
  { id: "finance", label: "Finance" },
  { id: "usage", label: "Usage" },
] as const;

const CROSS_HUB = [
  { id: "competition", label: "Competition", href: "/competition" },
  { id: "build", label: "Build", href: "/build" },
] as const;

export type AiHubRelatedId = (typeof AI_TABS)[number]["id"] | (typeof CROSS_HUB)[number]["id"];

/** Soft-UI cross-links between AI hub surfaces and Competition / Build. */
export function AiHubRelated({
  orgId,
  active,
  className,
}: {
  orgId?: string | null;
  active?: AiHubRelatedId;
  className?: string;
}) {
  return (
    <nav
      className={["product-hub-related", "ai-hub-related", className].filter(Boolean).join(" ")}
      aria-label="Related AI and season tools"
    >
      {AI_TABS.map((link) => {
        if (link.id === active) return null;
        return (
          <a key={link.id} className="app-button secondary" href={hubHref("/ai", link.id, orgId)}>
            {link.label}
          </a>
        );
      })}
      {CROSS_HUB.map((link) => {
        if (link.id === active) return null;
        return (
          <a key={link.id} className="app-button secondary" href={withOrgHref(link.href, orgId)}>
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
