"use client";

/**
 * One horizontal map of every settings surface — Personal chips, then Team
 * chips for owners/admins. Rendered at the top of settings pages so "where do
 * I change X" always has an answer on screen.
 *
 * Fetches nothing: the mounting page passes the role it already loaded.
 */

import { Icon } from "./icon";
import {
  activeSettingsId,
  visibleSettingsNav,
  type SettingsNavItem,
} from "../lib/nav/settings-nav";
import { withOrgHref } from "../lib/nav/product-nav";
import "./settings-bar.css";
import { KitCard, KitEyebrow, KitRow, type KitTone } from "./ui/kit";

type SettingsBarProps = {
  /** Raw org role from the page's own data ("owner" | "admin" | "scout" | …, or null). */
  role: string | null | undefined;
  /** This team, so team links keep their ?orgId= context. */
  orgId?: string | null;
  /** Current route path, e.g. "/account". */
  pathname: string;
  /**
   * Current ?tab= value when the page manages tabs client-side (the /account
   * tabs use history.replaceState, so the mount passes its live tab state).
   */
  activeTab?: string | null;
};

function chipHref(item: SettingsNavItem, orgId: string | null | undefined): string {
  return item.scope === "team" ? withOrgHref(item.href, orgId ?? null) : item.href;
}

/**
 * Settings, as two different things instead of ten identical pills.
 *
 * This was one flat wall of chips — ten of them, in two rows, at the top of
 * the page. They looked alike and behaved differently: three were tabs of the
 * page you were already on, and the other seven were links to other pages
 * entirely. Nothing on screen told you which was which, so every one of them
 * was a small gamble about whether the page was about to change under you.
 *
 * Now the tabs are a segmented control, because that is what a set of views of
 * one page looks like, and the destinations are rows with chevrons, because
 * that is what going somewhere looks like.
 */
function isOnAccountPage(item: SettingsNavItem): boolean {
  return item.href === "/account" || item.href.startsWith("/account?");
}

const ROW_TONES: Record<string, KitTone> = {
  security: "teal",
  connectors: "violet",
  "team-admin": "blue",
  "member-access": "amber",
  chat: "cyan",
  "team-ai-keys": "violet",
  "data-export": "green",
};

function RowGroup({
  label,
  items,
  orgId,
}: {
  label: string;
  items: SettingsNavItem[];
  orgId: string | null | undefined;
}) {
  if (!items.length) return null;
  return (
    <>
      <KitEyebrow>{label}</KitEyebrow>
      <KitCard>
        {items.map((item) => (
          <KitRow
            key={item.id}
            icon={item.icon}
            tone={ROW_TONES[item.id] ?? "blue"}
            title={item.label}
            href={chipHref(item, orgId)}
          />
        ))}
      </KitCard>
    </>
  );
}

export function SettingsBar({ role, orgId, pathname, activeTab }: SettingsBarProps) {
  const items = visibleSettingsNav(role);
  const search = activeTab ? `tab=${activeTab}` : "";
  const activeId = activeSettingsId(items, pathname, search);

  const tabs = items.filter(isOnAccountPage);
  const personal = items.filter((item) => item.scope === "personal" && !isOnAccountPage(item));
  const team = items.filter((item) => item.scope === "team" && !isOnAccountPage(item));

  return (
    <>
      {tabs.length > 1 ? (
        <nav className="kit-segment settings-tabs" aria-label="Account sections">
          {tabs.map((item) => (
            <a
              key={item.id}
              href={chipHref(item, orgId)}
              aria-current={item.id === activeId ? "page" : undefined}
              aria-selected={item.id === activeId}
            >
              <Icon name={item.icon} />
              {item.label}
            </a>
          ))}
        </nav>
      ) : null}

      <RowGroup label="Your settings" items={personal} orgId={orgId} />
      <RowGroup label="Team settings" items={team} orgId={orgId} />
    </>
  );
}
