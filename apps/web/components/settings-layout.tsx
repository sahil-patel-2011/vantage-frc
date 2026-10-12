"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ROLE_LABELS, type AccessRole } from "@vantage/core/role-words";
import { Icon, type IconName } from "./icon";
import { withOrgHref } from "../lib/nav/product-nav";
import { fetchProductSession, type ProductSession } from "../lib/nav/product-session";
import { URL_CHANGE_EVENT } from "../lib/nav/url-change";
import {
  SETTINGS_GROUP_LABELS,
  activeSettingsId,
  settingsRoleTier,
  visibleSettingsNav,
  type SettingsNavItem,
} from "../lib/nav/settings-nav";
import "./settings-layout.css";

const InSettingsLayout = createContext(false);

/** True inside the Settings frame: pages drop their own chip rows and section switchers. */
export function useInSettingsLayout(): boolean {
  return useContext(InSettingsLayout);
}

/** The address's query, following soft navigations and in-place tab changes. */
function useLocationSearch(): string {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  useEffect(() => {
    const read = () => setSearch(window.location.search);
    read();
    window.addEventListener("popstate", read);
    window.addEventListener(URL_CHANGE_EVENT, read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener(URL_CHANGE_EVENT, read);
    };
  }, [pathname]);
  return search;
}

/**
 * "Join code", "Money managers" and "Delete account" are parts of a page (#join-code …). The
 * page fills in after its data arrives, so the browser's own jump finds nothing: wait for the
 * part to exist, then bring it into view once.
 */
function useScrollToHash(pathname: string, search: string) {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const target = document.getElementById(id);
      tries += 1;
      if (!target && tries < 40) return;
      window.clearInterval(timer);
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    }, 100);
    return () => window.clearInterval(timer);
  }, [pathname, search]);
}

/** Who is looking and on which team, from the shared /api/me read (no extra request). */
function useSettingsViewer(orgId: string) {
  const [session, setSession] = useState<ProductSession | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchProductSession(orgId || null)
      .then((data) => {
        if (!cancelled) setSession(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);
  const teamId = orgId || session?.orgId || "";
  const membership = session?.memberships?.find((row) => row.orgId === teamId);
  const role = membership?.role ?? session?.role ?? null;
  const teamNumber = membership?.teamNumber ?? session?.teamNumber ?? null;
  const teamName = membership?.orgName ?? session?.orgName ?? null;
  const teamLabel = teamNumber ? `Team ${teamNumber}` : teamName || "";
  return { ready: session !== null, role, teamId, teamLabel, platformAdmin: session?.platformAdmin === true };
}

/** Platform admin, from Settings: the console's parts, for people who run Vantage itself. */
const PLATFORM_ROWS: Array<{ id: string; href: string; label: string; detail: string; icon: IconName }> = [
  { id: "platform-teams", href: "/admin/teams", label: "Teams and requests", detail: "Add teams, approve requests to join, and ban teams", icon: "users" },
  { id: "platform-admins", href: "/admin/admins", label: "Platform admins", detail: "Who helps you run Vantage, and handing it over", icon: "shield" },
  { id: "platform-ai", href: "/admin/ai-credits", label: "AI credits", detail: "Give a team AI from your own keys, with a hard cap", icon: "sparkles" },
  { id: "platform-health", href: "/admin/health", label: "Health", detail: "Email, sign-in, data sync and the database", icon: "activity" },
];

function PlatformSettings() {
  return (
    <section aria-labelledby="settings-group-platform" className="settings-list is-detailed">
      <h2 className="settings-group-label" id="settings-group-platform">Platform</h2>
      <ul className="settings-group">
        {PLATFORM_ROWS.map((item) => (
          <li key={item.id}>
            <a href={item.href} className="settings-row">
              <i className="settings-row-icon" aria-hidden="true"><Icon name={item.icon} /></i>
              <span className="settings-row-copy">
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
              <Icon name="chevron" className="settings-row-chevron" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function roleWords(role: string | null): string {
  const key = (role ?? "").toLowerCase() as AccessRole;
  return ROLE_LABELS[key] ?? "";
}

/**
 * The Settings list: "You", then "This team" (what this person's role allows). The column
 * beside every settings page, and — with each row's one-line detail — the /settings page itself.
 */
export function SettingsList({
  items,
  orgId,
  activeId,
  role,
  teamLabel,
  ready,
  detailed = false,
}: {
  items: SettingsNavItem[];
  orgId: string;
  activeId: string | null;
  role: string | null;
  teamLabel: string;
  ready: boolean;
  detailed?: boolean;
}) {
  const personal = items.filter((item) => item.scope === "personal");
  const team = items.filter((item) => item.scope === "team");
  const lead = settingsRoleTier(role) === "owner-admin";
  const row = (item: SettingsNavItem) => (
    <li key={item.id}>
      <a
        href={withOrgHref(item.href, orgId || null)}
        className={`settings-row${item.danger ? " is-danger" : ""}`}
        aria-current={item.id === activeId ? "page" : undefined}
      >
        <i className="settings-row-icon" aria-hidden="true"><Icon name={item.icon} /></i>
        <span className="settings-row-copy">
          <strong>{item.label}</strong>
          {detailed ? <small>{item.detail}</small> : null}
        </span>
        <Icon name="chevron" className="settings-row-chevron" />
      </a>
    </li>
  );
  return (
    <nav className={`settings-list${detailed ? " is-detailed" : ""}`} aria-label="Settings sections">
      <section aria-labelledby="settings-group-you">
        <h2 className="settings-group-label" id="settings-group-you">{SETTINGS_GROUP_LABELS.personal}</h2>
        <ul className="settings-group">{personal.map(row)}</ul>
      </section>
      {orgId || teamLabel ? (
        <section aria-labelledby="settings-group-team">
          <h2 className="settings-group-label" id="settings-group-team">
            {SETTINGS_GROUP_LABELS.team}
            {teamLabel ? <span className="settings-group-team">{teamLabel}{roleWords(role) ? ` · ${roleWords(role)}` : ""}</span> : null}
          </h2>
          {team.length ? (
            <ul className="settings-group">{team.map(row)}</ul>
          ) : ready && !lead ? (
            <p className="settings-group-note">
              The team&apos;s settings are changed by its owner and its mentors or coaches. Ask one of them, or see the
              team&apos;s people in Team.
            </p>
          ) : null}
        </section>
      ) : null}
    </nav>
  );
}

/**
 * One frame for every settings page (/account, /security, /connectors, /team/admin …): the
 * Settings list in a column on the left on wider screens, the page on the right. On a phone
 * the page is full width and the top bar's back button returns to the list (/settings).
 */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const search = useLocationSearch();
  const orgId = new URLSearchParams(search).get("orgId") ?? "";
  const viewer = useSettingsViewer(orgId);
  const items = visibleSettingsNav(viewer.role);
  const activeId = activeSettingsId(items, pathname, search);
  useScrollToHash(pathname, search);
  return (
    <InSettingsLayout.Provider value>
      <div className="settings-frame">
        <aside className="settings-column" aria-label="Settings">
          <a className="settings-column-title" href={withOrgHref("/settings", orgId || viewer.teamId || null)}>Settings</a>
          <SettingsList
            items={items}
            orgId={orgId || viewer.teamId}
            activeId={activeId}
            role={viewer.role}
            teamLabel={viewer.teamLabel}
            ready={viewer.ready}
          />
        </aside>
        <div className="settings-pane">{children}</div>
      </div>
    </InSettingsLayout.Provider>
  );
}

/** /settings: the list itself, with a line under each row. */
export function SettingsHome() {
  const search = useLocationSearch();
  const orgId = new URLSearchParams(search).get("orgId") ?? "";
  const viewer = useSettingsViewer(orgId);
  const items = visibleSettingsNav(viewer.role);
  return (
    <main className="module-page settings-home" id="main-content">
      <header className="settings-home-head">
        <h1>Settings</h1>
        <p>Everything you can change about your account, and the team settings your role allows.</p>
      </header>
      <SettingsList
        items={items}
        orgId={orgId || viewer.teamId}
        activeId={null}
        role={viewer.role}
        teamLabel={viewer.teamLabel}
        ready={viewer.ready}
        detailed
      />
      {viewer.platformAdmin ? <PlatformSettings /> : null}
    </main>
  );
}
