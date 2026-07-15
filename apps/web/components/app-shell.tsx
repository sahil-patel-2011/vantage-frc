"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Me = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  orgId?: string | null;
  teamNumber?: number | null;
  role?: string | null;
  platformAdmin?: boolean;
};

type NavItem = { href: string; label: string; icon: IconName; state?: "setup" | "planned" };
type NavGroup = { label: string; tone: string; toneBg: string; icon: IconName; items: NavItem[] };

type IconName =
  | "menu" | "search" | "bell" | "x" | "home" | "swords" | "scout" | "stats"
  | "chevron" | "chat" | "target" | "calendar" | "clipboard" | "users" | "bolt"
  | "cube" | "code" | "display" | "gear" | "grid" | "pin" | "back";

const groups: NavGroup[] = [
  {
    label: "Core",
    tone: "#2563eb",
    toneBg: "#dbeafe",
    icon: "swords",
    items: [
      { href: "/dashboard", label: "Home", icon: "home" },
      { href: "/intel", label: "Matches", icon: "swords" },
      { href: "/workspace", label: "Schedule", icon: "calendar" },
    ],
  },
  {
    label: "Scouting",
    tone: "#16a34a",
    toneBg: "#dcfce7",
    icon: "scout",
    items: [
      { href: "/scouting", label: "Scouting Hub", icon: "clipboard" },
      { href: "/intel", label: "Teams", icon: "users" },
      { href: "/strategy", label: "Strategy & AI", icon: "bolt" },
    ],
  },
  {
    label: "Build",
    tone: "#7c3aed",
    toneBg: "#ede9fe",
    icon: "cube",
    items: [
      { href: "/cad", label: "AI CAD", icon: "cube", state: "setup" },
      { href: "/code", label: "Code", icon: "code" },
      { href: "/display", label: "Displays", icon: "display" },
    ],
  },
  {
    label: "Team",
    tone: "#0f766e",
    toneBg: "#ccfbf1",
    icon: "gear",
    items: [
      { href: "/team", label: "Admin", icon: "gear" },
      { href: "/account", label: "Account", icon: "users" },
      { href: "/security", label: "Security", icon: "gear" },
      { href: "/chat", label: "Vantage AI", icon: "chat" },
    ],
  },
];

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
  return <svg aria-hidden="true" viewBox="0 0 24 24" {...p}>{paths[name]}</svg>;
}

function withOrg(href: string, orgId: string) {
  if (!orgId) return href;
  if (["/dashboard", "/account", "/security", "/admin"].includes(href)) return href;
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}orgId=${encodeURIComponent(orgId)}`;
}

const primaryTabs = [
  { href: "/dashboard", label: "Home", icon: "home" as const },
  { href: "/intel", label: "Matches", icon: "swords" as const },
  { href: "/scouting", label: "Scout", icon: "scout" as const },
  { href: "/strategy", label: "Stats", icon: "stats" as const },
];

export default function AppShell({ themeControl }: { themeControl: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [orgId, setOrgId] = useState("");
  const [open, setOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [me, setMe] = useState<Me>({});

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orgId") ?? "";
    setOrgId(id);
    document.body.classList.add("has-app-shell");
    return () => document.body.classList.remove("has-app-shell");
  }, [pathname]);

  useEffect(() => {
    void fetch("/api/me")
      .then(async (response) => (response.ok ? ((await response.json()) as Me) : null))
      .then((data) => {
        if (!data) return;
        setMe(data);
        if (!orgId && data.orgId) setOrgId(data.orgId);
      })
      .catch(() => undefined);
  }, [orgId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const initial = (me.name?.trim()?.[0] ?? me.email?.trim()?.[0] ?? "V").toUpperCase();
  const flat = useMemo(() => groups.flatMap((group) => group.items), []);
  const showBack = pathname.startsWith("/account") || pathname.startsWith("/team") || pathname.startsWith("/admin") || pathname.startsWith("/security");
  const title = pathname.startsWith("/account")
    ? "Account"
    : pathname.startsWith("/admin")
      ? "Admin"
      : pathname.startsWith("/team")
        ? "Admin"
        : pathname.startsWith("/security")
          ? "Security"
          : null;

  return (
    <>
      <header className="soft-topbar">
        {showBack ? (
          <div className="soft-page-head">
            <button className="soft-icon-btn" type="button" aria-label="Go back" onClick={() => router.back()}>
              <Icon name="back" />
            </button>
            <h1>{title}</h1>
          </div>
        ) : (
          <button className="soft-icon-btn" type="button" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
        )}
        <div className="soft-topbar-actions">
          <button className="soft-icon-btn" type="button" aria-label="Search" onClick={() => setCommandOpen(true)}>
            <Icon name="search" />
          </button>
          <button className="soft-icon-btn soft-notif" type="button" aria-label="Notifications">
            <Icon name="bell" />
            <b>0</b>
          </button>
          <a className="soft-avatar" href="/account" aria-label="Account">
            {initial}
          </a>
          <span className="soft-theme-slot">{themeControl}</span>
        </div>
      </header>

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
        <a className="soft-profile-link" href="/account" onClick={() => setOpen(false)}>
          <span className="soft-avatar">{initial}</span>
          <div>
            <strong>{me.name ?? "Signed-in user"}</strong>
            <span>{me.email ?? "Open account settings"}</span>
          </div>
          <Icon name="chevron" />
        </a>
        <p className="soft-drawer-hint">Only the main places you use most.</p>
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
                <span className="planned" key={item.label}>
                  <Icon name={item.icon} />
                  {item.label}
                  <small>Planned</small>
                </span>
              ) : (
                <a
                  aria-current={pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href)) ? "page" : undefined}
                  href={withOrg(item.href, orgId)}
                  key={item.label}
                  onClick={() => setOpen(false)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                  {item.state === "setup" ? <small>Setup</small> : <span className="chev"><Icon name="chevron" /></span>}
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
            aria-current={pathname === tab.href || (tab.href !== "/dashboard" && pathname.startsWith(tab.href)) ? "page" : undefined}
            href={withOrg(tab.href, orgId)}
            key={tab.href}
          >
            <Icon name={tab.icon} />
            {tab.label}
          </a>
        ))}
      </nav>

      <a className="soft-fab" href={withOrg("/chat", orgId)} aria-label="Open Vantage AI chat">
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
                <a href={withOrg(item.href, orgId)} key={`${item.href}-${item.label}`} onClick={() => setCommandOpen(false)}>
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
