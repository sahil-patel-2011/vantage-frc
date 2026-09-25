"use client";

/**
 * One horizontal map of every settings surface — Personal chips, then Team
 * chips for owners/admins. Rendered at the top of settings pages so "where do
 * I change X" always has an answer on screen.
 *
 * Fetches nothing: the mounting page passes the role it already loaded.
 */

import { visibleSettingsNav, type SettingsNavItem } from "../lib/nav/settings-nav";
import { withOrgHref } from "../lib/nav/product-nav";
import "./settings-bar.css";
import { KitCard, KitEyebrow, KitRow, type KitTone } from "./ui/kit";

type SettingsBarProps = {
  /** Raw org role from the page's own data ("owner" | "admin" | "scout" | …, or null). */
  role: string | null | undefined;
  /** This team, so team links keep their ?orgId= context. */
  orgId?: string | null;
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

/** One line under each row, so "Security" and "Team security" side by side say how they differ. */
const ROW_DETAIL: Record<string, string> = {
  security: "Your sign-in and a second step",
  connectors: "Onshape, Google and other tools linked to the team",
  "team-admin": "Invite people and choose what each can do",
  "member-access": "How everyone on the team signs in",
  chat: "Reports and the private-message rules",
  "team-profile": "Location, colour and logo",
  "team-data": "What the team has recorded, and event data",
  "team-ai-keys": "The team's AI key, limits and model training",
  "data-export": "Download the team's data",
};

const ROW_TONES: Record<string, KitTone> = {
  security: "teal",
  connectors: "violet",
  "team-admin": "blue",
  "member-access": "amber",
  chat: "cyan",
  "team-profile": "teal",
  "team-data": "blue",
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
            subtitle={ROW_DETAIL[item.id]}
            href={chipHref(item, orgId)}
          />
        ))}
      </KitCard>
    </>
  );
}

export function SettingsBar({ role, orgId }: SettingsBarProps) {
  const items = visibleSettingsNav(role);
  // Connectors are set up once for the whole team; for someone who runs the team they sit with
  // the team's settings. A member keeps the row with their own (their Onshape link can expire).
  const lead = items.some((item) => item.scope === "team");
  const teamScoped = (item: SettingsNavItem) => item.scope === "team" || (lead && item.id === "connectors");
  const personal = items.filter((item) => !teamScoped(item) && !isOnAccountPage(item));
  const team = items.filter((item) => teamScoped(item) && !isOnAccountPage(item));

  return (
    <>
      {/* The Profile / Appearance / Notifications switcher used to be here as
          well, as a row of links labelled "Account sections".

          The account page renders its own switcher for those three, with the
          same accessible name, so the page carried two `navigation` landmarks
          by that name — a duplicate control, and a locator for it matched two
          elements, which is what had the account browser test failing. This
          component is only ever used on that page, so its copy is the one
          that goes: the page's own switcher is the one that changes the panel
          in place without a reload. What stays here is the part the page does
          not have — the rows that go somewhere else. */}
      <RowGroup label="Your settings" items={personal} orgId={orgId} />
      <RowGroup label="Team settings" items={team} orgId={orgId} />
    </>
  );
}
