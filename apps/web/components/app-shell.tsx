"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { VantageLogo } from "./brand";

type NavItem = { href?: string; label: string; icon: string; state?: "setup" | "planned" };

const groups: Array<{ label: string; items: NavItem[] }> = [
  { label: "Competition", items: [
    { href: "/dashboard", label: "Command Center", icon: "grid" },
    { href: "/scouting", label: "Scout", icon: "check" },
    { href: "/intel", label: "Intel", icon: "search" },
    { href: "/strategy", label: "Strategy", icon: "chart" },
  ] },
  { label: "Build", items: [
    { href: "/cad", label: "CAD", icon: "cube", state: "setup" },
    { href: "/code", label: "Code", icon: "code" },
    { label: "Robot Ops", icon: "wrench", state: "planned" },
  ] },
  { label: "Operations", items: [
    { href: "/display", label: "Displays", icon: "display" },
    { href: "/team", label: "Team & Admin", icon: "users" },
  ] },
];

function Icon({ name }: { name: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
    check: <><path d="M4 5h16v15H4z"/><path d="m8 12 3 3 6-7"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
    chart: <><path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/></>,
    cube: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 7 9 5 9-5v10l-9 5-9-5V7Z"/><path d="M12 12v10"/></>,
    code: <><path d="m8 8-5 4 5 4m8-8 5 4-5 4m-3-11-2 14"/></>,
    wrench: <><path d="M14 6a5 5 0 0 0-6.5 6.5L3 17l4 4 4.5-4.5A5 5 0 0 0 18 10l-3 3-4-4 3-3Z"/></>,
    display: <><rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8m-4-4v4"/></>,
    users: <><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0m1-16a4 4 0 0 1 0 7m2 3a6 6 0 0 1 3 6"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}>{paths[name]}</svg>;
}

function addOrg(href: string, orgId: string) {
  return orgId && !["/dashboard", "/security"].includes(href) ? `${href}?orgId=${encodeURIComponent(orgId)}` : href;
}

export default function AppShell({ themeControl }: { themeControl: React.ReactNode }) {
  const pathname = usePathname();
  const [orgId, setOrgId] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    setOrgId(new URLSearchParams(window.location.search).get("orgId") ?? "");
    document.body.classList.add("has-app-shell");
    return () => document.body.classList.remove("has-app-shell");
  }, [pathname]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const flatItems = useMemo(() => groups.flatMap((group) => group.items).filter((item) => item.href), []);

  return <>
    <aside className={`app-sidebar ${menuOpen ? "open" : ""}`} aria-label="Product navigation">
      <div className="app-sidebar-brand"><VantageLogo href="/dashboard" /></div>
      <a className="workspace-switcher" href="/workspace">
        <span>Workspace</span><strong>{orgId ? "Active team" : "Select a team"}</strong><small>{orgId ? "Organization context set" : "No organization selected"}</small>
      </a>
      {groups.map((group) => <nav key={group.label} aria-label={group.label}><span>{group.label}</span>{group.items.map((item) => item.href ? <a aria-current={pathname === item.href ? "page" : undefined} href={addOrg(item.href, orgId)} key={item.label}><Icon name={item.icon}/><b>{item.label}</b>{item.state && <small>{item.state === "setup" ? "Setup" : "Planned"}</small>}</a> : <span className="disabled-nav" aria-disabled="true" key={item.label}><Icon name={item.icon}/><b>{item.label}</b><small>Planned</small></span>)}</nav>)}
      <a className="sidebar-settings" href="/security"><Icon name="wrench"/><span>Settings</span></a>
    </aside>
    <header className="app-topbar">
      <button className="mobile-menu-button" type="button" aria-label="Toggle product menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><span/><span/><span/></button>
      <button className="command-entry" type="button" onClick={() => setCommandOpen(true)}><Icon name="search"/><span>Search teams, matches, tools…</span><kbd>Ctrl K</kbd></button>
      <div className="topbar-status"><span><i/> Local ready</span><a href="/display">Displays</a><a href="/security" aria-label="Profile and settings">Profile</a>{themeControl}</div>
    </header>
    <nav className="mobile-product-nav" aria-label="Mobile product navigation">
      {flatItems.slice(0, 4).map((item) => <a aria-current={pathname === item.href ? "page" : undefined} href={addOrg(item.href!, orgId)} key={item.label}><Icon name={item.icon}/><span>{item.label === "Command Center" ? "Home" : item.label}</span></a>)}
      <button type="button" onClick={() => setMenuOpen(true)}><Icon name="grid"/><span>More</span></button>
    </nav>
    {menuOpen && <button className="shell-scrim" aria-label="Close product menu" onClick={() => setMenuOpen(false)} />}
    {commandOpen && <div className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title"><div><header><h2 id="command-title">Go to a Vantage module</h2><button type="button" aria-label="Close command menu" onClick={() => setCommandOpen(false)}>×</button></header><label>Search<input autoFocus placeholder="Try “scouting” or “CAD”" /></label><nav>{flatItems.map((item) => <a href={addOrg(item.href!, orgId)} key={item.label}><Icon name={item.icon}/><span>{item.label}</span>{item.state && <small>{item.state}</small>}</a>)}</nav></div></div>}
  </>;
}
