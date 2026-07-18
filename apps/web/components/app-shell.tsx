"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  PRIMARY_TABS,
  PRODUCT_NAV_GROUPS,
  breadcrumbForPath,
  findNavMatch,
  navTitleForPath,
  withOrgHref,
  type ProductNavIcon,
} from "../lib/nav/product-nav";
import { signOutAndRedirect } from "../lib/sign-out";

type Me = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
  platformAdmin?: boolean;
  unreadNotificationCount?: number;
  unreadMessageCount?: number;
};

type IconName = ProductNavIcon;

const groups = PRODUCT_NAV_GROUPS;
const primaryTabs = PRIMARY_TABS;

function Icon({ name }: { name: IconName }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, React.ReactNode> = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></>,
    bell: <><path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
    x: <><path d="M6 6l12 12M18 6 6 18" /></>,
    home: <><path d="m4 11 8-7 8 7" /><path d="M6 10v10h12V10" /></>,
    swords: <><path d="m14.5 17.5 3 3m-11-3 3 3M4 4l7 7M20 4l-7 7M8 16l-4 4m12-4 4 4" /></>,
    scout: <><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" /><circle cx="12" cy="12" r="3" /></>,
    stats: <><path d="M5 19V10m7 9V5m7 14v-7" /></>,
    chevron: <><path d="m9 6 6 6-6 6" /></>,
    chat: <><path d="M5 6h14v9H9l-4 4V6z" /><circle cx="9" cy="10.5" r=".8" fill="currentColor" /><circle cx="12" cy="10.5" r=".8" fill="currentColor" /><circle cx="15" cy="10.5" r=".8" fill="currentColor" /></>,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
    clipboard: <><rect x="6" y="5" width="12" height="16" rx="2" /><path d="M9 5V4h6v1M9 11h6M9 15h4" /></>,
    users: <><circle cx="9" cy="8" r="3.5" /><path d="M3 19a6 6 0 0 1 12 0M16 8a3 3 0 1 1 0 6m2 5a5 5 0 0 0-3-4.5" /></>,
    bolt: <><path d="M13 2 5 14h6l-1 8 8-12h-6l1-8z" /></>,
    cube: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 7 9 5 9-5v10l-9 5-9-5V7Z" /></>,
    code: <><path d="m8 8-4 4 4 4m8-8 4 4-4 4m-2-11-2 14" /></>,
    display: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10L5.6 18.4" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
    pin: <><path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
    back: <><path d="M15 6 9 12l6 6" /></>,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={18} height={18} {...p}>
      {paths[name]}
    </svg>
  );
}

export default function AppShell({ themeControl }: { themeControl: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [orgId, setOrgId] = useState("");
  const [open, setOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [me, setMe] = useState<Me>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orgId") ?? "";
    setOrgId(id);
    document.body.classList.add("has-app-shell");
    return () => document.body.classList.remove("has-app-shell");
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle("soft-nav-open", open || commandOpen);
    return () => document.body.classList.remove("soft-nav-open");
  }, [open, commandOpen]);

  useEffect(() => {
    void fetch("/api/me")
      .then(async (response) => (response.ok ? ((await response.json()) as Me) : null))
      .then((data) => {
        if (!data) return;
        setMe(data);
        const count = Number(data.unreadNotificationCount ?? 0);
        setUnreadCount(Number.isFinite(count) && count > 0 ? Math.floor(count) : 0);
        const messages = Number(data.unreadMessageCount ?? 0);
        setUnreadMessages(Number.isFinite(messages) && messages > 0 ? Math.floor(messages) : 0);
        if (!orgId && data.orgId) setOrgId(data.orgId);
      })
      .catch(() => undefined);
  }, [orgId, pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setOpen(false);
        setAccountMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const initial = (me.name?.trim()?.[0] ?? me.email?.trim()?.[0] ?? "V").toUpperCase();
  const flat = useMemo(() => {
    const items = groups.flatMap((group) => group.items);
    if (me.platformAdmin) {
      items.push({ href: "/admin", label: "Global Team Manager", icon: "grid" });
    }
    return items;
  }, [me.platformAdmin]);
  const showBack =
    pathname.startsWith("/account") ||
    pathname.startsWith("/team") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/security") ||
    pathname.startsWith("/notifications") ||
    pathname.startsWith("/help");
  const title =
    navTitleForPath(pathname) ??
    (pathname.startsWith("/account")
      ? "Account"
      : pathname.startsWith("/notifications")
        ? "Notifications"
        : pathname.startsWith("/admin")
          ? "Admin"
          : pathname.startsWith("/help")
            ? "Help & Support"
            : pathname.startsWith("/security")
              ? "Security"
              : null);
  const orgLabel =
    me.teamNumber != null
      ? `Team ${me.teamNumber}${me.orgName ? ` · ${me.orgName}` : ""}`
      : me.orgName ?? (orgId ? "Active workspace" : "No workspace selected");
  const crumbHint = breadcrumbForPath(pathname);
  const activeNav = findNavMatch(pathname);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setOpen(false);
    await signOutAndRedirect("/");
  }

  return (
    <>
      <header className="soft-topbar">
        {showBack ? (
          <div className="soft-page-head">
            <button className="soft-icon-btn" type="button" aria-label="Go back" onClick={() => router.back()}>
              <Icon name="back" />
            </button>
            <div className="soft-page-head-copy">
              <h1>{title}</h1>
              <small className="soft-org-crumb">{crumbHint}</small>
            </div>
          </div>
        ) : (
          <button
            className="soft-icon-btn soft-menu-btn"
            type="button"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" />
          </button>
        )}
        <div className="soft-topbar-actions">
          <button className="soft-icon-btn" type="button" aria-label="Search" onClick={() => setCommandOpen(true)}>
            <Icon name="search" />
          </button>
          <a
            className="soft-icon-btn soft-notif"
            href="/notifications"
            aria-label={unreadCount >= 1 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          >
            <Icon name="bell" />
            {unreadCount >= 1 ? <b data-count={unreadCount}>{unreadCount > 99 ? "99+" : unreadCount}</b> : null}
          </a>
          <div className="soft-account-menu">
            <button
              className="soft-avatar soft-avatar-btn"
              type="button"
              aria-label="Account menu"
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              onClick={() => setAccountMenuOpen((value) => !value)}
            >
              {initial}
            </button>
            {accountMenuOpen ? (
              <div className="soft-account-pop" role="menu" aria-label="Account">
                <div className="soft-account-pop-head">
                  <strong>{me.name ?? "Signed-in user"}</strong>
                  <span>{me.email ?? "Account"}</span>
                  <span className="soft-account-org">{orgLabel}</span>
                </div>
                <a role="menuitem" href="/account" onClick={() => setAccountMenuOpen(false)}>
                  Account settings
                </a>
                <a role="menuitem" href="/account?tab=notifications" onClick={() => setAccountMenuOpen(false)}>
                  Notification &amp; email prefs
                </a>
                <a role="menuitem" href="/notifications" onClick={() => setAccountMenuOpen(false)}>
                  Inbox
                  {unreadCount >= 1 ? <b>{unreadCount > 99 ? "99+" : unreadCount}</b> : null}
                </a>
                <a role="menuitem" href={withOrgHref("/messages", orgId)} onClick={() => setAccountMenuOpen(false)}>
                  Team messages
                  {unreadMessages >= 1 ? <b>{unreadMessages > 99 ? "99+" : unreadMessages}</b> : null}
                </a>
                <a role="menuitem" href="/security" onClick={() => setAccountMenuOpen(false)}>
                  Security
                </a>
                {orgId ? (
                  <a role="menuitem" href={withOrgHref("/team", orgId)} onClick={() => setAccountMenuOpen(false)}>
                    API keys &amp; team admin
                  </a>
                ) : null}
                <button
                  role="menuitem"
                  type="button"
                  className="soft-account-signout"
                  disabled={signingOut}
                  onClick={() => void handleSignOut()}
                >
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            ) : null}
          </div>
          <span className="soft-theme-slot">{themeControl}</span>
        </div>
      </header>
      {accountMenuOpen ? (
        <button className="soft-account-scrim" type="button" aria-label="Close account menu" onClick={() => setAccountMenuOpen(false)} />
      ) : null}

      {open && <button className="soft-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
      <aside className={`soft-drawer ${open ? "open" : ""}`} aria-label="Product navigation">
        <div className="soft-drawer-head">
          <div className="soft-drawer-brand">
            <span className="mark">v</span>
            <div>
              <strong>Vantage</strong>
              <small>Navigation</small>
            </div>
          </div>
          <button className="soft-icon-btn" type="button" aria-label="Close" onClick={() => setOpen(false)}>
            <Icon name="x" />
          </button>
        </div>
        <div className="soft-profile-block">
          <a className="soft-profile-link" href="/account" onClick={() => setOpen(false)}>
            <span className="soft-avatar">{initial}</span>
            <div>
              <strong>{me.name ?? "Signed-in user"}</strong>
              <span>{me.email ?? "Account settings"}</span>
            </div>
            <span className="soft-profile-chev" aria-hidden="true">
              <Icon name="chevron" />
            </span>
          </a>
          <div className="soft-org-chip" title={orgLabel}>
            <Icon name="users" />
            <div>
              <strong>{orgLabel}</strong>
              <span>{me.role ? `${me.role} · org context on links` : "Pick a workspace from Home"}</span>
            </div>
            <a href={withOrgHref("/workspace", orgId)} onClick={() => setOpen(false)}>
              Switch
            </a>
          </div>
          <div className="soft-profile-actions">
            <a href="/account" onClick={() => setOpen(false)}>
              Account
            </a>
            <a href="/account?tab=notifications" onClick={() => setOpen(false)}>
              Prefs
            </a>
            <a href="/security" onClick={() => setOpen(false)}>
              Security
            </a>
            <button type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
        <p className="soft-drawer-hint">Competition · Calendar · Team · Business — unfinished items stay Planned.</p>
        {groups.map((group) => (
          <section className="soft-nav-group" key={group.label} style={{ ["--tone" as string]: group.tone, ["--tone-bg" as string]: group.toneBg }}>
            <div className="soft-nav-heading">
              <i>
                <Icon name={group.icon} />
              </i>
              {group.label}
            </div>
            {group.items.map((item) =>
              item.state === "planned" ? (
                <span className="planned" key={`${group.label}-${item.label}`}>
                  <Icon name={item.icon} />
                  {item.label}
                  <small>Planned</small>
                </span>
              ) : (
                <a
                  aria-current={
                    activeNav?.item.href === item.href && activeNav.group.label === group.label ? "page" : undefined
                  }
                  href={withOrgHref(item.href, orgId)}
                  key={`${group.label}-${item.label}`}
                  onClick={() => setOpen(false)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                  {item.href === "/messages" && unreadMessages >= 1 ? (
                    <b className="soft-nav-badge">{unreadMessages > 99 ? "99+" : unreadMessages}</b>
                  ) : item.state === "setup" ? (
                    <small>Setup</small>
                  ) : (
                    <span className="chev">
                      <Icon name="chevron" />
                    </span>
                  )}
                </a>
              ),
            )}
          </section>
        ))}
        {me.platformAdmin && (
          <section className="soft-nav-group">
            <div className="soft-nav-heading">
              <i>
                <Icon name="grid" />
              </i>
              Platform
            </div>
            <a href="/admin" onClick={() => setOpen(false)}>
              <Icon name="grid" />
              Global Team Manager
              <span className="chev">
                <Icon name="chevron" />
              </span>
            </a>
          </section>
        )}
      </aside>

      <nav className="soft-island" aria-label="Primary tabs">
        {primaryTabs.map((tab) => (
          <a
            aria-current={
              pathname === tab.href ||
              (tab.href === "/team/calendar" && (pathname.startsWith("/team/calendar") || pathname === "/calendar")) ||
              (tab.href !== "/dashboard" && tab.href !== "/team/calendar" && pathname.startsWith(tab.href))
                ? "page"
                : undefined
            }
            href={withOrgHref(tab.href, orgId)}
            key={tab.href}
          >
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
          </a>
        ))}
        <button
          type="button"
          className="soft-island-more"
          aria-label="Open full navigation"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Icon name="grid" />
          <span>More</span>
        </button>
      </nav>

      <a className="soft-fab" href={withOrgHref("/chat", orgId)} aria-label="Open Vantage AI chat">
        <Icon name="chat" />
      </a>

      {commandOpen && (
        <div className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title">
          <div>
            <header>
              <h2 id="command-title">Go to a Vantage module</h2>
              <button type="button" aria-label="Close" onClick={() => setCommandOpen(false)}>
                ×
              </button>
            </header>
            <nav>
              {flat.map((item) => (
                <a href={withOrgHref(item.href, orgId)} key={`${item.href}-${item.label}`} onClick={() => setCommandOpen(false)}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.state && <small>{item.state}</small>}
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

export { Icon };
export type { IconName };
