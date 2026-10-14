"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { pushAppNavigation } from "../lib/nav/soft-navigation";
import { ROLE_LABELS, type AccessRole } from "@vantage/core/role-words";
import { Icon, type IconName } from "./icon";
import { withOrgHref } from "../lib/nav/product-nav";
import { fetchProductSession, type ProductSession } from "../lib/nav/product-session";
import { URL_CHANGE_EVENT } from "../lib/nav/url-change";
import {
  settingsNavGroups,
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
  // A read that never answered left "This team" as a bare heading for good. It is asked once
  // more after a pause, then says so with a way to ask again.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const load = (retries: number): Promise<void> =>
      fetchProductSession(orgId || null).then((data) => {
        if (cancelled) return;
        if (data) {
          setSession(data);
          return;
        }
        if (retries > 0) {
          return new Promise<void>((resolve) => window.setTimeout(resolve, 800)).then(() =>
            cancelled ? undefined : load(retries - 1),
          );
        }
        setFailed(true);
      });
    void load(1);
    return () => {
      cancelled = true;
    };
  }, [orgId, attempt]);
  const teamId = orgId || session?.orgId || "";
  const membership = session?.memberships?.find((row) => row.orgId === teamId);
  const role = membership?.role ?? session?.role ?? null;
  const teamNumber = membership?.teamNumber ?? session?.teamNumber ?? null;
  const teamName = membership?.orgName ?? session?.orgName ?? null;
  const teamLabel = teamNumber ? `Team ${teamNumber}` : teamName || "";
  return {
    ready: session !== null,
    failed: failed && session === null,
    retry: () => setAttempt((count) => count + 1),
    role,
    teamId,
    teamLabel,
    platformAdmin: session?.platformAdmin === true,
  };
}

/** Platform admin, from Settings: the console's parts, for people who run Vantage itself. */
const PLATFORM_ROWS: Array<{ id: string; href: string; label: string; detail: string; icon: IconName }> = [
  { id: "platform-teams", href: "/admin/teams", label: "Teams and requests", detail: "Add teams, approve requests to join, and ban teams", icon: "users" },
  { id: "platform-admins", href: "/admin/admins", label: "Platform admins", detail: "Who helps you run Vantage, and handing it over", icon: "shield" },
  { id: "platform-ai", href: "/admin/ai-credits", label: "AI credits", detail: "Give a team AI from your own keys, with a hard cap", icon: "sparkles" },
  { id: "platform-health", href: "/admin/health", label: "Health", detail: "Email, sign-in, data sync and the database", icon: "activity" },
];

function matchesSettingsSearch(item: { label: string; detail: string; keywords?: string[] }, query: string) {
  const text = [item.label, item.detail, ...(item.keywords ?? [])].join(" ").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word => text.includes(word));
}

function PlatformSettings({ query = "" }: { query?: string }) {
  const rows = PLATFORM_ROWS.filter(item => matchesSettingsSearch(item, query));
  if (!rows.length) return null;
  return (
    <section aria-labelledby="settings-group-platform" className="settings-list is-detailed">
      <h2 className="settings-group-label" id="settings-group-platform">Platform</h2>
      <ul className="settings-group">
        {rows.map((item) => (
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
  failed = false,
  onRetry,
  detailed = false,
  showTeamNotice = true,
}: {
  items: SettingsNavItem[];
  orgId: string;
  activeId: string | null;
  role: string | null;
  teamLabel: string;
  ready: boolean;
  failed?: boolean;
  onRetry?: () => void;
  detailed?: boolean;
  showTeamNotice?: boolean;
}) {
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
      {settingsNavGroups(items).map(group => <section key={group.label} aria-label={group.label}>
        <h2 className="settings-group-label">{group.label}</h2>
        <ul className="settings-group">{group.items.map(row)}</ul>
      </section>)}
      {showTeamNotice && (orgId || teamLabel) && !team.length ? (
        <section aria-labelledby="settings-group-team">
          <h2 className="settings-group-label" id="settings-group-team">
            Team settings
            {teamLabel ? <span className="settings-group-team">{teamLabel}{roleWords(role) ? ` · ${roleWords(role)}` : ""}</span> : null}
          </h2>
          {team.length ? (
            <ul className="settings-group">{team.map(row)}</ul>
          ) : failed ? (
            <p className="settings-group-note" role="status">
              Couldn&apos;t load this team&apos;s settings.{" "}
              {onRetry ? (
                <button type="button" className="settings-retry" onClick={onRetry}>Try again</button>
              ) : null}
            </p>
          ) : !ready ? (
            // Rows the shape of the real ones while the role loads, not an empty heading.
            <ul className="settings-group settings-group-loading" aria-busy="true" aria-label="Loading team settings">
              {[0, 1, 2].map((index) => (
                <li key={index}><span className="settings-row settings-row-skeleton" /></li>
              ))}
            </ul>
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
 * One reading column for settings pages, with a section selector and an All settings link.
 * The full directory remains on /settings; pages drop their own duplicate navigation rows.
 */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pickerId = useId();
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
        <nav className="settings-navigation" aria-label="Settings navigation">
          <a href={withOrgHref("/settings", orgId || viewer.teamId || null)}><Icon name="back" /> All settings</a>
          <label htmlFor={pickerId}>
            <span className="sr-only">Settings section</span>
            <select id={pickerId} value={activeId ?? ""} onChange={event => {
              const item = items.find(item => item.id === event.target.value);
              if (item) pushAppNavigation(path => router.push(path), withOrgHref(item.href, orgId || viewer.teamId || null));
            }}>
              {!activeId ? <option value="" disabled>Choose a section</option> : null}
              {settingsNavGroups(items).map(group => <optgroup key={group.label} label={group.label}>
                {group.items.filter(item => !item.href.includes("#")).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </optgroup>)}
            </select>
          </label>
          {viewer.failed ? <button className="settings-retry" type="button" onClick={viewer.retry}>Reload team settings</button> : null}
        </nav>
        <div className="settings-pane">{children}</div>
      </div>
    </InSettingsLayout.Provider>
  );
}

/** /settings: the list itself, with a line under each row. */
export function SettingsHome() {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const search = useLocationSearch();
  const orgId = new URLSearchParams(search).get("orgId") ?? "";
  const viewer = useSettingsViewer(orgId);
  const items = visibleSettingsNav(viewer.role);
  const matches = items.filter(item => matchesSettingsSearch(item, query));
  const platformMatches = viewer.platformAdmin ? PLATFORM_ROWS.filter(item => matchesSettingsSearch(item, query)).length : 0;
  const matchCount = matches.length + platformMatches;
  return (
    <main className="module-page settings-home" id="main-content">
      <header className="settings-home-head">
        <h1>Settings</h1>
        <p>Everything you can change about your account, and the team settings your role allows.</p>
      </header>
      <div className="settings-search">
        <label className="sr-only" htmlFor={searchId}>Find a setting</label>
        <Icon name="search" />
        <input id={searchId} ref={searchRef} type="search" placeholder="Find a setting…" value={query}
          onChange={event => setQuery(event.target.value)} />
        {query ? <button type="button" aria-label="Clear settings search" onClick={() => {
          setQuery("");
          searchRef.current?.focus();
        }}><Icon name="x" /></button> : null}
      </div>
      {query.trim() ? <p className="settings-search-status" role="status">
        {matchCount ? `${matchCount} ${matchCount === 1 ? "setting" : "settings"} found.` : viewer.ready ? "No settings found. Try a name like notifications, invites, or AI." : ""}
        {viewer.failed ? <> Team settings couldn&apos;t load. <button type="button" className="settings-retry" onClick={viewer.retry}>Try again</button></> : !viewer.ready ? " Loading team settings…" : null}
      </p> : null}
      <SettingsList
        items={matches}
        orgId={orgId || viewer.teamId}
        activeId={null}
        role={viewer.role}
        teamLabel={viewer.teamLabel}
        ready={viewer.ready}
        failed={viewer.failed}
        onRetry={viewer.retry}
        detailed
        showTeamNotice={!query.trim()}
      />
      {viewer.platformAdmin ? <PlatformSettings query={query} /> : null}
    </main>
  );
}
