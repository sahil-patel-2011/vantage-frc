"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShellOutboxStatus } from "./shell-outbox-status";
import {
  ISLAND_TAB_CATALOG,
  MORE_SHEET_LINKS,
  ORG_EXEMPT_HREFS,
  PILLAR_SHEET_LINKS,
  PRODUCT_NAV_GROUPS,
  breadcrumbForPath,
  findNavMatch,
  navTitleForPath,
  withOrgHref,
  withSelectedOrgHref,
  type ProductNavIcon,
} from "../lib/nav/product-nav";
import { defaultIslandHrefs, resolveIslandTabs } from "../lib/nav/island-preferences";
import {
  pathAllowedByHubAccess,
  type ClientHubAccessRow,
} from "../lib/nav/hub-access-filter";
import { listRecentOrgIds, rememberRecentOrg, sortMembershipsByRecent } from "../lib/nav/recent-teams";
import { type MyDayView } from "../lib/my-day";
import { buildEventFocus } from "../lib/event-focus";
import { signOutAndRedirect } from "../lib/sign-out";

type SearchHit = {
  title: string;
  subtitle?: string | null;
  href: string;
  sourceLabel?: string;
};

type MembershipOption = {
  orgId: string;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
};

type Me = {
  name?: string | null;
  firstName?: string | null;
  displayName?: string | null;
  email?: string | null;
  image?: string | null;
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
  planCode?: string | null;
  paidOrg?: boolean;
  memberships?: MembershipOption[];
  platformAdmin?: boolean;
  unreadNotificationCount?: number;
  unreadMessageCount?: number;
  hubAccess?: ClientHubAccessRow[] | null;
  sponsorsAllowed?: boolean | null;
  schoolFunded?: boolean | null;
  outsideGrants?: boolean | null;
  teamAffiliation?: string | null;
};

type IconName = ProductNavIcon;

const groups = PRODUCT_NAV_GROUPS;
const pillarSheetLinks = PILLAR_SHEET_LINKS;
const moreSheetLinks = MORE_SHEET_LINKS;

function formatMembershipLabel(row: MembershipOption): string {
  const team =
    row.teamNumber != null && Number.isFinite(row.teamNumber) ? `Team ${row.teamNumber}` : null;
  const name = row.orgName?.trim() || null;
  const parts = [team, name].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Team workspace";
}

function formatRolePlanCue(role?: string | null, planCode?: string | null, paidOrg?: boolean): string {
  const roleLabel = role?.trim() ? role.trim() : null;
  const planLabel = planCode?.trim()
    ? paidOrg
      ? planCode.trim()
      : `${planCode.trim()} plan`
    : null;
  if (roleLabel && planLabel) return `${roleLabel} · ${planLabel}`;
  if (roleLabel) return roleLabel;
  if (planLabel) return planLabel;
  return "Workspace";
}

function islandTabIsActive(pathname: string, search: string, tabHref: string): boolean {
  const [pathPart, queryPart] = tabHref.split("?");
  const path = pathPart || tabHref;
  if (pathname !== path && !(path !== "/" && pathname.startsWith(`${path}/`))) {
    if (tabHref === "/dashboard") return pathname === "/dashboard" || pathname === "/";
    return false;
  }
  if (!queryPart) {
    if (tabHref === "/dashboard") return pathname === "/dashboard" || pathname === "/";
    if (path === "/team/calendar") return pathname.startsWith("/team/calendar") || pathname === "/calendar";
    return pathname === path || pathname.startsWith(`${path}/`);
  }
  const want = new URLSearchParams(queryPart.split("#")[0] || "");
  const have = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const [key, value] of want.entries()) {
    if (have.get(key) !== value) return false;
  }
  return true;
}

function activeIslandHref(
  pathname: string,
  search: string,
  tabs: Array<{ href: string }>,
): string | undefined {
  const queryMatch = tabs.find((tab) => tab.href.includes("?") && islandTabIsActive(pathname, search, tab.href));
  return queryMatch?.href ?? tabs.find((tab) => islandTabIsActive(pathname, search, tab.href))?.href;
}

function Icon({ name }: { name: IconName }) {
  const p = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<IconName, React.ReactNode> = {
    menu: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m16 16 5 5" />
      </>
    ),
    bell: (
      <>
        <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </>
    ),
    x: (
      <>
        <path d="M6 6l12 12M18 6 6 18" />
      </>
    ),
    home: (
      <>
        <path d="m4 11 8-7 8 7" />
        <path d="M6 10v10h12V10" />
      </>
    ),
    swords: (
      <>
        <path d="m14.5 17.5 3 3m-11-3 3 3M4 4l7 7M20 4l-7 7M8 16l-4 4m12-4 4 4" />
      </>
    ),
    scout: (
      <>
        <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    stats: (
      <>
        <path d="M5 19V10m7 9V5m7 14v-7" />
      </>
    ),
    chevron: (
      <>
        <path d="m9 6 6 6-6 6" />
      </>
    ),
    chat: (
      <>
        <path d="M5 6h14v9H9l-4 4V6z" />
        <circle cx="9" cy="10.5" r=".8" fill="currentColor" />
        <circle cx="12" cy="10.5" r=".8" fill="currentColor" />
        <circle cx="15" cy="10.5" r=".8" fill="currentColor" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </>
    ),
    clipboard: (
      <>
        <rect x="6" y="5" width="12" height="16" rx="2" />
        <path d="M9 5V4h6v1M9 11h6M9 15h4" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 19a6 6 0 0 1 12 0M16 8a3 3 0 1 1 0 6m2 5a5 5 0 0 0-3-4.5" />
      </>
    ),
    bolt: (
      <>
        <path d="M13 2 5 14h6l-1 8 8-12h-6l1-8z" />
      </>
    ),
    cube: (
      <>
        <path d="m12 2 9 5-9 5-9-5 9-5Z" />
        <path d="m3 7 9 5 9-5v10l-9 5-9-5V7Z" />
      </>
    ),
    code: (
      <>
        <path d="m8 8-4 4 4 4m8-8 4 4-4 4m-2-11-2 14" />
      </>
    ),
    display: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8m-4-4v4" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10L5.6 18.4" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </>
    ),
    pin: (
      <>
        <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    back: (
      <>
        <path d="M15 6 9 12l6 6" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={18} height={18} {...p}>
      {paths[name]}
    </svg>
  );
}

function defaultExpandedGroups(activeLabel: string | undefined): Record<string, boolean> {
  const next: Record<string, boolean> = { Home: true };
  if (activeLabel && activeLabel !== "Home") next[activeLabel] = true;
  return next;
}

export default function AppShell() {
  const pathname = usePathname();
  const router = useRouter();
  const [orgId, setOrgId] = useState("");
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [me, setMe] = useState<Me>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [myDayGlance, setMyDayGlance] = useState<MyDayView | null>(null);
  const [online, setOnline] = useState(true);
  const [focusCollapsed, setFocusCollapsed] = useState(false);
  const [islandHrefs, setIslandHrefs] = useState<string[]>(defaultIslandHrefs);
  const [islandDraft, setIslandDraft] = useState<string[]>(defaultIslandHrefs);
  const [islandEditorOpen, setIslandEditorOpen] = useState(false);
  const [islandSaving, setIslandSaving] = useState(false);
  const [islandMessage, setIslandMessage] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [memberships, setMemberships] = useState<MembershipOption[]>([]);
  const [recentOrgIds, setRecentOrgIds] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [pathSearch, setPathSearch] = useState("");
  const [commandQuery, setCommandQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const searchRequestId = useRef(0);
  const islandQueryOpened = useRef(false);

  const activeNav = findNavMatch(pathname);
  const activeGroupLabel = activeNav?.group.label;

  useEffect(() => {
    setExpandedGroups((prev) => ({ ...defaultExpandedGroups(activeGroupLabel), ...prev, Home: true, ...(activeGroupLabel ? { [activeGroupLabel]: true } : {}) }));
  }, [activeGroupLabel]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orgId") ?? "";
    setOrgId(id);
    document.body.classList.add("has-app-shell");
    return () => document.body.classList.remove("has-app-shell");
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle(
      "soft-nav-open",
      open || commandOpen || moreOpen || accountMenuOpen || islandEditorOpen || workspaceOpen,
    );
    return () => document.body.classList.remove("soft-nav-open");
  }, [open, commandOpen, moreOpen, accountMenuOpen, islandEditorOpen, workspaceOpen]);

  useEffect(() => {
    setPathSearch(window.location.search);
  }, [pathname]);

  useEffect(() => {
    setOpen(false);
    setMoreOpen(false);
    setCommandOpen(false);
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
    setWorkspaceOpen(false);
  }, [pathname]);

  useEffect(() => {
    setRecentOrgIds(listRecentOrgIds());
  }, []);

  useEffect(() => {
    if (!commandOpen) {
      setCommandQuery("");
      setSearchHits([]);
      setSearchLoading(false);
      return;
    }
    const focusTimer = window.setTimeout(() => commandInputRef.current?.focus(), 30);
    return () => window.clearTimeout(focusTimer);
  }, [commandOpen]);

  useEffect(() => {
    if (!commandOpen) return;
    const q = commandQuery.trim();
    if (q.length < 2) {
      setSearchHits([]);
      setSearchLoading(false);
      return;
    }
    const id = ++searchRequestId.current;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q });
      if (orgId) params.set("orgId", orgId);
      void fetch(`/api/search?${params.toString()}`, { cache: "no-store" })
        .then(async (response) =>
          response.ok
            ? ((await response.json()) as { status?: string; results?: SearchHit[] })
            : null,
        )
        .then((data) => {
          if (id !== searchRequestId.current) return;
          const rows =
            data?.status === "ready" && Array.isArray(data.results) ? data.results.slice(0, 8) : [];
          setSearchHits(
            rows.map((row) => ({
              title: row.title,
              subtitle: row.subtitle,
              href: row.href,
              sourceLabel: row.sourceLabel,
            })),
          );
          setSearchLoading(false);
        })
        .catch(() => {
          if (id !== searchRequestId.current) return;
          setSearchHits([]);
          setSearchLoading(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [commandOpen, commandQuery, orgId]);

  useEffect(() => {
    const meUrl = orgId ? `/api/me?orgId=${encodeURIComponent(orgId)}` : "/api/me";
    void fetch(meUrl)
      .then(async (response) => (response.ok ? ((await response.json()) as Me) : null))
      .then((data) => {
        if (!data) return;
        setMe(data);
        const rows = Array.isArray(data.memberships)
          ? data.memberships.filter((row): row is MembershipOption => Boolean(row?.orgId))
          : [];
        setMemberships(rows);
        const count = Number(data.unreadNotificationCount ?? 0);
        setUnreadCount(Number.isFinite(count) && count > 0 ? Math.floor(count) : 0);
        const messages = Number(data.unreadMessageCount ?? 0);
        setUnreadMessages(Number.isFinite(messages) && messages > 0 ? Math.floor(messages) : 0);
        if (!orgId && data.orgId) setOrgId(data.orgId);
      })
      .catch(() => undefined);
  }, [orgId, pathname]);

  useEffect(() => {
    void fetch("/api/navigation/preferences", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ tabs?: unknown }> : null)
      .then((data) => {
        if (!data) return;
        const tabs = resolveIslandTabs(data.tabs).map((item) => item.href);
        setIslandHrefs(tabs);
        setIslandDraft(tabs);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (islandQueryOpened.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("island") === "1" || params.get("customize") === "island") {
      islandQueryOpened.current = true;
      setIslandDraft(islandHrefs);
      setIslandMessage("");
      setIslandEditorOpen(true);
    }
  }, [pathname, islandHrefs]);

  function openIslandEditor() {
    setIslandDraft(islandHrefs);
    setIslandMessage("");
    setMoreOpen(false);
    setOpen(false);
    setIslandEditorOpen(true);
  }

  useEffect(() => {
    if (!orgId) {
      setMyDayGlance(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      void fetch(withOrgHref("/api/my-day", orgId), { cache: "no-store" })
        .then(async (response) => (response.ok ? ((await response.json()) as MyDayView) : null))
        .then((view) => {
          if (!cancelled && view) setMyDayGlance(view);
        })
        .catch(() => undefined);
    };
    load();
    const refresh = window.setInterval(load, 60_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
      document.removeEventListener("visibilitychange", load);
    };
  }, [orgId]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        setMoreOpen(false);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setOpen(false);
        setMoreOpen(false);
        setAccountMenuOpen(false);
        setIslandEditorOpen(false);
        setWorkspaceOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const accountLabel =
    me.displayName?.trim() ||
    me.name?.trim() ||
    me.firstName?.trim() ||
    me.email?.trim() ||
    null;
  const initial = (accountLabel?.[0] ?? "?").toUpperCase();

  const hubAccess = me.hubAccess ?? null;
  const visiblePillarLinks = useMemo(
    () => pillarSheetLinks.filter((link) => pathAllowedByHubAccess(link.href, hubAccess)),
    [hubAccess],
  );
  const visibleMoreLinks = useMemo(
    () => moreSheetLinks.filter((link) => pathAllowedByHubAccess(link.href, hubAccess)),
    [hubAccess],
  );
  const visibleIslandCatalog = useMemo(
    () => ISLAND_TAB_CATALOG.filter((item) => pathAllowedByHubAccess(item.href, hubAccess)),
    [hubAccess],
  );
  const visibleNavGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => pathAllowedByHubAccess(item.href, hubAccess)),
        }))
        .filter((group) => group.items.length > 0),
    [hubAccess],
  );

  const flat = useMemo(() => {
    const items = visibleNavGroups.flatMap((group) => group.items);
    if (me.platformAdmin) {
      items.push({ href: "/admin", label: "Global Team Manager", icon: "grid" });
    }
    // Dedupe by href so Cmd+K never lists the same module twice (e.g. Offline Shell).
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.href)) return false;
      seen.add(item.href);
      return true;
    });
  }, [me.platformAdmin, visibleNavGroups]);

  const filteredNav = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    if (!q) {
      // Empty query: glanceable shortcuts only — typing unlocks the full module list.
      const shortcuts: Array<{ href: string; label: string; icon: ProductNavIcon; state?: undefined }> = [
        { href: "/dashboard", label: "Home", icon: "home" },
        ...visiblePillarLinks,
        ...visibleMoreLinks,
        { href: "/help", label: "Help", icon: "clipboard" },
        { href: "/account", label: "Account", icon: "gear" },
      ];
      const seen = new Set<string>();
      return shortcuts.filter((item) => {
        if (seen.has(item.href)) return false;
        seen.add(item.href);
        return true;
      });
    }
    return flat.filter((item) => {
      const hay = `${item.label} ${item.href} ${item.state ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [commandQuery, flat, visibleMoreLinks, visiblePillarLinks]);

  const orderedMemberships = useMemo(
    () => sortMembershipsByRecent(memberships, recentOrgIds),
    [memberships, recentOrgIds],
  );

  /** Hub roots keep the hamburger — Back replaces Menu and strands mobile users. */
  const isHubRoot =
    pathname === "/" ||
    pathname === "/dashboard" ||
    pathname === "/competition" ||
    pathname === "/team" ||
    pathname === "/business" ||
    pathname === "/build" ||
    pathname === "/ai";

  const showBack =
    !isHubRoot &&
    (pathname.startsWith("/account") ||
      pathname.startsWith("/team/") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/security") ||
      pathname.startsWith("/notifications") ||
      pathname.startsWith("/help") ||
      pathname === "/support");

  const backHref = useMemo(() => {
    if (pathname.startsWith("/account")) return "/dashboard";
    if (pathname.startsWith("/security")) return "/account";
    if (pathname === "/support") return "/help";
    if (pathname.startsWith("/help/") || pathname === "/help") {
      return pathname === "/help" ? "/dashboard" : "/help";
    }
    if (pathname.startsWith("/notifications")) return "/dashboard";
    if (pathname.startsWith("/admin/") || pathname === "/admin") {
      return pathname === "/admin" ? "/dashboard" : "/admin";
    }
    if (pathname.startsWith("/team/")) {
      return withOrgHref("/team", orgId || null);
    }
    return "/dashboard";
  }, [pathname, orgId]);

  const title =
    navTitleForPath(pathname) ??
    (pathname.startsWith("/account")
      ? "Account"
      : pathname.startsWith("/notifications")
        ? "Notifications"
        : pathname.startsWith("/admin")
          ? "Admin"
          : pathname.startsWith("/help")
            ? "Help"
            : pathname === "/support"
              ? "Support"
              : pathname.startsWith("/security")
                ? "Security"
                : null);

  const orgLabel =
    me.teamNumber != null
      ? `Team ${me.teamNumber}${me.orgName ? ` · ${me.orgName}` : ""}`
      : (me.orgName ?? (orgId ? "Active workspace" : "No workspace selected"));
  const rolePlanCue = formatRolePlanCue(me.role, me.planCode, me.paidOrg);

  const crumbHint = breadcrumbForPath(pathname);
  const moreBadgeTotal = unreadCount + unreadMessages;
  const eventFocus = useMemo(() => buildEventFocus(myDayGlance, online), [myDayGlance, online]);
  const islandTabs = useMemo(
    () => resolveIslandTabs(islandHrefs).filter((tab) => pathAllowedByHubAccess(tab.href, hubAccess)),
    [islandHrefs, hubAccess],
  );
  const activeIslandTabHref = useMemo(
    () => activeIslandHref(pathname, pathSearch, islandTabs),
    [islandTabs, pathname, pathSearch],
  );

  useEffect(() => {
    document.body.classList.toggle("has-event-focus", Boolean(eventFocus && !focusCollapsed));
    return () => document.body.classList.remove("has-event-focus");
  }, [eventFocus, focusCollapsed]);

  const toggleGroup = useCallback((label: string) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }, []);

  const closeOverlays = useCallback(() => {
    setOpen(false);
    setMoreOpen(false);
    setCommandOpen(false);
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
    setWorkspaceOpen(false);
  }, []);

  const switchWorkspaceHref = useCallback(
    (nextOrgId: string) => {
      const pathOnly = pathname.split("?")[0] || pathname;
      // Account/admin chrome is org-exempt — land on Workspace with the selected team.
      if (ORG_EXEMPT_HREFS.has(pathOnly) || pathOnly.startsWith("/admin")) {
        return withOrgHref("/workspace", nextOrgId);
      }
      return withSelectedOrgHref(`${pathname}${pathSearch || ""}` || "/competition", nextOrgId);
    },
    [pathname, pathSearch],
  );

  const onWorkspaceSwitch = useCallback((nextOrgId: string) => {
    setRecentOrgIds(rememberRecentOrg(nextOrgId));
  }, []);

  const openFullSearch = useCallback(() => {
    const q = commandQuery.trim();
    const href = withOrgHref(q ? `/search?q=${encodeURIComponent(q)}` : "/search", orgId || null);
    setCommandOpen(false);
    router.push(href);
  }, [commandQuery, orgId, router]);

  const jumpCommandTopResult = useCallback(() => {
    const firstHit = searchHits[0];
    if (firstHit) {
      setCommandOpen(false);
      router.push(firstHit.href);
      return;
    }
    const q = commandQuery.trim();
    if (!q) {
      openFullSearch();
      return;
    }
    const firstNav = filteredNav[0];
    if (firstNav) {
      setCommandOpen(false);
      router.push(withOrgHref(firstNav.href, orgId || null));
      return;
    }
    openFullSearch();
  }, [commandQuery, filteredNav, openFullSearch, orgId, router, searchHits]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    closeOverlays();
    await signOutAndRedirect("/");
  }

  function toggleIslandDraft(href: string) {
    setIslandMessage("");
    setIslandDraft((current) => {
      if (current.includes(href)) return current.filter((item) => item !== href);
      return current.length < 4 ? [...current, href] : current;
    });
  }

  async function saveIsland() {
    if (islandDraft.length !== 4 || islandSaving) return;
    setIslandSaving(true);
    setIslandMessage("");
    try {
      const response = await fetch("/api/navigation/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tabs: islandDraft }),
      });
      const data = await response.json() as { tabs?: unknown; error?: string };
      if (!response.ok) {
        setIslandMessage(data.error ?? "Could not save the island.");
        return;
      }
      const tabs = resolveIslandTabs(data.tabs).map((item) => item.href);
      setIslandHrefs(tabs);
      setIslandDraft(tabs);
      setIslandEditorOpen(false);
    } catch {
      setIslandMessage("Could not save the island. Check your connection and try again.");
    } finally {
      setIslandSaving(false);
    }
  }

  function navItemBadge(itemHref: string) {
    const path = itemHref.split("?")[0] || itemHref;
    const isMessages =
      itemHref === "/messages" ||
      itemHref.startsWith("/messages?") ||
      (path === "/team" && itemHref.includes("tab=messages"));
    if (isMessages && unreadMessages >= 1) {
      return <b className="soft-nav-badge">{unreadMessages > 99 ? "99+" : unreadMessages}</b>;
    }
    if (itemHref === "/notifications" && unreadCount >= 1) {
      return <b className="soft-nav-badge">{unreadCount > 99 ? "99+" : unreadCount}</b>;
    }
    return null;
  }

  return (
    <>
      <a className="soft-skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className={`soft-topbar${accountMenuOpen ? " account-menu-open" : ""}`}>
        <div className={`soft-topbar-lead${showBack ? " has-back" : ""}`}>
          <button
            className={`soft-icon-btn soft-menu-btn${open ? " is-open" : ""}`}
            type="button"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => {
              setOpen((value) => !value);
              setMoreOpen(false);
            }}
          >
            <span className="soft-burger" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
          {showBack ? (
            <div className="soft-page-head">
              <button
                className="soft-icon-btn"
                type="button"
                aria-label="Go back"
                onClick={() => router.push(backHref)}
              >
                <Icon name="back" />
              </button>
              <div className="soft-page-head-copy">
                <h1>{title}</h1>
                <small className="soft-org-crumb">{crumbHint}</small>
              </div>
            </div>
          ) : null}
        </div>
        <div className="soft-topbar-actions">
          <ShellOutboxStatus orgId={orgId || null} />
          <button
            className="soft-icon-btn soft-search-btn"
            type="button"
            aria-label="Search"
            onClick={() => {
              setCommandOpen(true);
              setMoreOpen(false);
            }}
          >
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
              {me.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.image} alt="" />
              ) : (
                initial
              )}
            </button>
            {accountMenuOpen ? (
              <div
                className="soft-account-pop"
                role="menu"
                aria-label="Account"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="soft-account-pop-head">
                  <strong>{accountLabel ?? "Signed-in user"}</strong>
                  <span>{me.email ?? "Account"}</span>
                  <span className="soft-account-org">{orgLabel}</span>
                  <span className="soft-account-org">{rolePlanCue}</span>
                </div>
                {memberships.length > 1 ? (
                  <div className="soft-account-teams" role="group" aria-label="Switch team workspace">
                    <span className="soft-account-teams-label">Teams</span>
                    {orderedMemberships.map((row) => (
                      <a
                        key={row.orgId}
                        role="menuitem"
                        href={switchWorkspaceHref(row.orgId)}
                        aria-current={row.orgId === orgId ? "true" : undefined}
                        onClick={() => {
                          onWorkspaceSwitch(row.orgId);
                          setAccountMenuOpen(false);
                        }}
                      >
                        {formatMembershipLabel(row)}
                        <small>
                          {row.role ?? "member"}
                          {recentOrgIds[0] === row.orgId && row.orgId !== orgId ? " · recent" : ""}
                        </small>
                      </a>
                    ))}
                  </div>
                ) : null}
                <a role="menuitem" href="/account" onClick={() => setAccountMenuOpen(false)}>
                  Account settings
                </a>
                <a role="menuitem" href="/account?tab=appearance" onClick={() => setAccountMenuOpen(false)}>
                  Appearance
                </a>
                <a role="menuitem" href="/security" onClick={() => setAccountMenuOpen(false)}>
                  Security
                </a>
                <a role="menuitem" href="/help" onClick={() => setAccountMenuOpen(false)}>
                  Help
                </a>
                <a role="menuitem" href="/support" onClick={() => setAccountMenuOpen(false)}>
                  Support tickets
                </a>
                {me.platformAdmin ? (
                  <a role="menuitem" href="/admin" onClick={() => setAccountMenuOpen(false)}>
                    Global Team Manager
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
        </div>
      </header>
      {eventFocus ? (
        focusCollapsed ? (
          <button
            className={`soft-focus-reopen ${eventFocus.tone}`}
            type="button"
            onClick={() => setFocusCollapsed(false)}
            aria-label={`Show event focus: ${eventFocus.title}`}
          >
            <span /> {eventFocus.title}
          </button>
        ) : (
          <section className={`soft-focus-rail ${eventFocus.tone}`} aria-label="Event focus" aria-live="polite">
            <span className="soft-focus-signal" aria-hidden="true" />
            <div className="soft-focus-copy">
              <strong>{eventFocus.title}</strong>
              <span>{eventFocus.detail}</span>
            </div>
            <small>{eventFocus.freshness}</small>
            <nav aria-label="Next match actions">
              {eventFocus.actions.map((action) => (
                <a className={action.emphasis} href={action.href} key={action.label}>{action.label}</a>
              ))}
            </nav>
            <button
              className="soft-focus-collapse"
              type="button"
              onClick={() => setFocusCollapsed(true)}
              aria-label="Collapse event focus"
            >
              ×
            </button>
          </section>
        )
      ) : null}
      {accountMenuOpen ? (
        <button
          className="soft-account-scrim"
          type="button"
          aria-label="Close account menu"
          onClick={() => setAccountMenuOpen(false)}
        />
      ) : null}

      {open ? <button className="soft-scrim" type="button" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
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
            <span className="soft-avatar">
              {me.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.image} alt="" />
              ) : (
                initial
              )}
            </span>
            <div>
              <strong>{accountLabel ?? "Signed-in user"}</strong>
              <span>{me.email ?? "Account settings"}</span>
            </div>
            <span className="soft-profile-chev" aria-hidden="true">
              <Icon name="chevron" />
            </span>
          </a>
          <div className={`soft-workspace-manager${workspaceOpen ? " is-open" : ""}`}>
            <button
              type="button"
              className="soft-org-chip soft-org-chip-btn"
              title={orgLabel}
              aria-expanded={workspaceOpen}
              aria-controls="soft-workspace-picker"
              onClick={() => setWorkspaceOpen((value) => !value)}
            >
              <Icon name="users" />
              <div>
                <strong>{orgLabel}</strong>
                <span>
                  {orgId
                    ? `${rolePlanCue} · links use this team`
                    : "No workspace — accept an invite or pick a team"}
                </span>
              </div>
              <span className={`soft-nav-caret${workspaceOpen ? " open" : ""}`} aria-hidden="true">
                <Icon name="chevron" />
              </span>
            </button>
            {workspaceOpen ? (
              <div id="soft-workspace-picker" className="soft-workspace-picker" role="listbox" aria-label="Team workspaces">
                {memberships.length === 0 ? (
                  <p className="soft-workspace-empty">
                    No real team memberships yet. Exact-email invites only — never DEMO organizations.
                  </p>
                ) : (
                  orderedMemberships.map((row) => (
                    <a
                      key={row.orgId}
                      role="option"
                      aria-selected={row.orgId === orgId}
                      href={switchWorkspaceHref(row.orgId)}
                      onClick={() => {
                        onWorkspaceSwitch(row.orgId);
                        setWorkspaceOpen(false);
                        setOpen(false);
                      }}
                    >
                      <strong>{formatMembershipLabel(row)}</strong>
                      <span>
                        {row.role ?? "member"}
                        {row.orgId === orgId ? " · active" : ""}
                        {recentOrgIds.includes(row.orgId) && row.orgId !== orgId ? " · recent" : ""}
                      </span>
                    </a>
                  ))
                )}
                <div className="soft-workspace-links">
                  <a href={withOrgHref("/workspace", orgId)} onClick={() => setOpen(false)}>
                    Workspace
                  </a>
                  <a href="/invite" onClick={() => setOpen(false)}>
                    Invite
                  </a>
                  <a href="/account" onClick={() => setOpen(false)}>
                    Account
                  </a>
                  {me.platformAdmin ? (
                    <a href="/admin" onClick={() => setOpen(false)}>
                      Teams admin
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="soft-profile-actions">
            <a href="/account" onClick={() => setOpen(false)}>
              Account
            </a>
            <button type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
        <nav className="soft-drawer-pillars" aria-label="Six pillars">
          {visiblePillarLinks.map((link) => (
            <a key={link.href} href={withOrgHref(link.href, orgId)} onClick={() => setOpen(false)}>
              <Icon name={link.icon} />
              {link.label}
            </a>
          ))}
        </nav>
        {visibleNavGroups.map((group) => {
          const expanded = !!expandedGroups[group.label];
          const visibleCount = group.items.filter((item) => item.state !== "planned").length;
          const isActiveGroup = activeGroupLabel === group.label;
          return (
            <section
              className={`soft-nav-group${isActiveGroup ? " is-active" : ""}`}
              key={group.label}
              style={{ ["--tone" as string]: group.tone, ["--tone-bg" as string]: group.toneBg }}
            >
              <button
                type="button"
                className="soft-nav-heading"
                aria-expanded={expanded}
                onClick={() => toggleGroup(group.label)}
              >
                <i>
                  <Icon name={group.icon} />
                </i>
                <span>{group.label}</span>
                <em className="soft-nav-count">{visibleCount}</em>
                <span className={`soft-nav-caret${expanded ? " open" : ""}`} aria-hidden="true">
                  <Icon name="chevron" />
                </span>
              </button>
              {expanded ? (
                <div className="soft-nav-items">
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
                        {navItemBadge(item.href) ??
                          (item.state === "setup" ? (
                            <small>Setup</small>
                          ) : (
                            <span className="chev">
                              <Icon name="chevron" />
                            </span>
                          ))}
                      </a>
                    ),
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
        {me.platformAdmin ? (
          <section className="soft-nav-group">
            <div className="soft-nav-heading static">
              <i>
                <Icon name="grid" />
              </i>
              <span>Platform</span>
            </div>
            <div className="soft-nav-items">
              <a href="/admin" onClick={() => setOpen(false)}>
                <Icon name="grid" />
                Global Team Manager
                <span className="chev">
                  <Icon name="chevron" />
                </span>
              </a>
            </div>
          </section>
        ) : null}
      </aside>

      <nav
        className="soft-island"
        aria-label="Primary tabs"
        title="Right-click or use More → Customize island to change these four apps"
        onContextMenu={(event) => {
          event.preventDefault();
          openIslandEditor();
        }}
      >
        {islandTabs.map((tab) => (
          <a
            aria-current={activeIslandTabHref === tab.href ? "page" : undefined}
            href={withOrgHref(tab.href, orgId)}
            key={tab.href}
          >
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
            {tab.href.includes("tab=messages") && unreadMessages >= 1 ? (
              <b className="soft-island-badge">{unreadMessages > 99 ? "99+" : unreadMessages}</b>
            ) : null}
          </a>
        ))}
        <button
          type="button"
          className={`soft-island-more${moreOpen ? " is-open" : ""}`}
          aria-label="Open more destinations"
          aria-expanded={moreOpen}
          onClick={() => {
            setMoreOpen((value) => !value);
            setOpen(false);
          }}
        >
          <Icon name="grid" />
          <span>More</span>
          {moreBadgeTotal >= 1 ? (
            <b className="soft-island-badge">{moreBadgeTotal > 99 ? "99+" : moreBadgeTotal}</b>
          ) : null}
        </button>
      </nav>

      {moreOpen ? (
        <button className="soft-more-scrim" type="button" aria-label="Close more menu" onClick={() => setMoreOpen(false)} />
      ) : null}
      <div className={`soft-more-sheet${moreOpen ? " open" : ""}`} role="dialog" aria-label="More destinations" aria-hidden={!moreOpen}>
        <div className="soft-more-handle" aria-hidden="true" />
        <div className="soft-more-head">
          <strong>More</strong>
          <button className="soft-icon-btn" type="button" aria-label="Close more menu" onClick={() => setMoreOpen(false)}>
            <Icon name="x" />
          </button>
        </div>
        <div className="soft-more-grid soft-more-pillars">
          {visiblePillarLinks.map((link) => (
            <a key={link.href} href={withOrgHref(link.href, orgId)} onClick={() => setMoreOpen(false)}>
              <Icon name={link.icon} />
              {link.label}
            </a>
          ))}
        </div>
        <div className="soft-more-grid soft-more-quick">
          {visibleMoreLinks.map((link) => (
            <a key={link.href} href={withOrgHref(link.href, orgId)} onClick={() => setMoreOpen(false)}>
              <Icon name={link.icon} />
              {link.label}
              {link.href.includes("tab=messages") && unreadMessages >= 1 ? (
                <b>{unreadMessages > 99 ? "99+" : unreadMessages}</b>
              ) : null}
            </a>
          ))}
        </div>
        <div className="soft-more-actions soft-more-actions-4">
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              setOpen(true);
            }}
          >
            <Icon name="menu" />
            Menu
          </button>
          <button
            type="button"
            onClick={() => {
              openIslandEditor();
            }}
          >
            <Icon name="gear" />
            Island
          </button>
          <a href="/help" onClick={() => setMoreOpen(false)}>
            <Icon name="clipboard" />
            Help
          </a>
          <a href={withOrgHref("/chat", orgId)} onClick={() => setMoreOpen(false)}>
            <Icon name="chat" />
            Chat
          </a>
        </div>
      </div>

      {islandEditorOpen ? (
        <div className="soft-island-editor" role="dialog" aria-modal="true" aria-labelledby="island-editor-title">
          <button className="soft-island-editor-scrim" type="button" aria-label="Close island customization" onClick={() => setIslandEditorOpen(false)} />
          <section>
            <header>
              <div>
                <span>PERSONAL NAVIGATION</span>
                <h2 id="island-editor-title">Choose your four island apps</h2>
                <p>The default stays Home, Compete, Team, and Business until you save a change.</p>
              </div>
              <button className="soft-icon-btn" type="button" aria-label="Close" onClick={() => setIslandEditorOpen(false)}><Icon name="x" /></button>
            </header>
            <div className="soft-island-slot-preview" aria-label={`${islandDraft.length} of 4 island apps selected`}>
              {[0, 1, 2, 3].map((slot) => {
                const selectedHref = islandDraft[slot];
                const selected = visibleIslandCatalog.find((entry) => entry.href === selectedHref)
                  ?? ISLAND_TAB_CATALOG.find((entry) => entry.href === selectedHref);
                return <span className={selectedHref ? "filled" : ""} key={slot}>{selected ? <><Icon name={selected.icon} />{selected.label}</> : `Slot ${slot + 1}`}</span>;
              })}
            </div>
            <p className="soft-island-order-hint">Tap apps in the order you want them to appear. Tap a selected app to remove it.</p>
            <div className="soft-island-choice-grid">
              {visibleIslandCatalog.map((item) => {
                const selected = islandDraft.includes(item.href);
                const disabled = !selected && islandDraft.length >= 4;
                return (
                  <button
                    className={selected ? "selected" : ""}
                    disabled={disabled}
                    key={item.href}
                    onClick={() => toggleIslandDraft(item.href)}
                    type="button"
                    aria-pressed={selected}
                  >
                    <Icon name={item.icon} /><span><strong>{item.label}</strong><small>{selected ? `Slot ${islandDraft.indexOf(item.href) + 1}` : "Add to island"}</small></span>
                  </button>
                );
              })}
            </div>
            {islandMessage ? <p className="soft-island-editor-error" role="alert">{islandMessage}</p> : null}
            <footer>
              <a href={withOrgHref("/dashboard?customize=1", orgId)}>Customize dashboard</a>
              <a href={withOrgHref("/competition?tab=forms", orgId)}>Build scouting forms</a>
              <button type="button" onClick={() => setIslandDraft(defaultIslandHrefs())}>Reset default</button>
              <button className="primary" type="button" disabled={islandDraft.length !== 4 || islandSaving} onClick={() => void saveIsland()}>
                {islandSaving ? "Saving…" : `Save ${islandDraft.length}/4`}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {!moreOpen && !islandEditorOpen ? (
        <a className="soft-fab soft-fab-desktop" href={withOrgHref("/chat", orgId)} aria-label="Open Vantage AI chat">
          <Icon name="chat" />
        </a>
      ) : null}

      {commandOpen ? (
        <div
          className="command-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="command-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) setCommandOpen(false);
          }}
        >
          <div onClick={(event) => event.stopPropagation()}>
            <header>
              <h2 id="command-title">Search &amp; jump</h2>
              <button type="button" aria-label="Close" onClick={() => setCommandOpen(false)}>
                ×
              </button>
            </header>
            <label htmlFor="soft-command-input">
              Filter modules or search help, tasks, inventory, impact, and knowledge
              <input
                id="soft-command-input"
                ref={commandInputRef}
                type="search"
                value={commandQuery}
                placeholder="Type to filter… Enter opens top result"
                autoComplete="off"
                onChange={(event) => setCommandQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (event.metaKey || event.ctrlKey) {
                      openFullSearch();
                      return;
                    }
                    jumpCommandTopResult();
                  }
                }}
              />
            </label>
            {searchHits.length > 0 || searchLoading ? (
              <section className="command-search-hits" aria-label="Search results">
                <header>
                  <strong>Results</strong>
                  {searchLoading ? <small>Searching…</small> : null}
                </header>
                <nav>
                  {searchHits.map((hit) => (
                    <a
                      href={hit.href}
                      key={`${hit.href}-${hit.title}`}
                      onClick={() => setCommandOpen(false)}
                    >
                      <Icon name="search" />
                      <span>
                        {hit.title}
                        {hit.subtitle ? <small>{hit.subtitle}</small> : null}
                      </span>
                      {hit.sourceLabel ? <small>{hit.sourceLabel}</small> : null}
                    </a>
                  ))}
                </nav>
                <button type="button" className="command-open-full" onClick={openFullSearch}>
                  Open full search{commandQuery.trim() ? ` for “${commandQuery.trim()}”` : ""}
                </button>
              </section>
            ) : null}
            <nav aria-label="Modules">
              {filteredNav.length === 0 ? (
                <p className="command-empty">No modules match — try full search (Ctrl/⌘+Enter).</p>
              ) : (
                <>
                  {!commandQuery.trim() ? (
                    <p className="command-empty">Shortcuts — type to search every module.</p>
                  ) : null}
                  {filteredNav.map((item) => (
                    <a
                      href={withOrgHref(item.href, orgId)}
                      key={`${item.href}-${item.label}`}
                      onClick={() => setCommandOpen(false)}
                    >
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                      {item.state ? <small>{item.state}</small> : null}
                    </a>
                  ))}
                </>
              )}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}

export { Icon };
export type { IconName };
