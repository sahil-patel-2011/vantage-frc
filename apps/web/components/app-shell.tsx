"use client";

import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShellOutboxStatus } from "./shell-outbox-status";
import { Icon, type IconName } from "./shell/icon";
import { ShellNav } from "./shell/shell-nav";
import {
  ISLAND_TAB_CATALOG,
  ORG_EXEMPT_HREFS,
  breadcrumbForPath,
  findNavMatch,
  navTitleForPath,
  withOrgHref,
  withSelectedOrgHref,
} from "../lib/nav/product-nav";
import { defaultIslandHrefs, resolveIslandTabs } from "../lib/nav/island-preferences";
import {
  pathAllowedByHubAccess,
  pathAllowedBySponsors,
  type ClientHubAccessRow,
} from "../lib/nav/hub-access-filter";
import { listRecentOrgIds, rememberRecentOrg, sortMembershipsByRecent } from "../lib/nav/recent-teams";
import { commandCatalog, searchCommands, type CommandHit } from "../lib/nav/command-search";
import { listRecentCommands, rememberRecentCommand } from "../lib/nav/recent-commands";
import {
  SIDEBAR_MEDIA_QUERY,
  buildShellHubs,
  readSidebarCollapsed,
  resolveShellRecents,
  shellQuickActions,
  writeSidebarCollapsed,
} from "../lib/nav/shell-model";
import { type MyDayView } from "../lib/my-day";
import { buildEventFocus } from "../lib/event-focus";
import { signOutAndRedirect } from "../lib/sign-out";
import "./shell/app-shell.css";

// Loaded lazily: theme-provider mounts this shell, so a static import would be a cycle.
const ThemeToggle = dynamic(() => import("../app/theme-provider").then((mod) => mod.ThemeToggle), { ssr: false });

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

export default function AppShell() {
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
  const [myDayGlance, setMyDayGlance] = useState<MyDayView | null>(null);
  const [online, setOnline] = useState(true);
  const [focusCollapsed, setFocusCollapsed] = useState(false);
  const [islandHrefs, setIslandHrefs] = useState<string[]>(defaultIslandHrefs);
  const [islandDraft, setIslandDraft] = useState<string[]>(defaultIslandHrefs);
  const [islandEditorOpen, setIslandEditorOpen] = useState(false);
  const [islandSaving, setIslandSaving] = useState(false);
  const [islandMessage, setIslandMessage] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  // Laptop-and-up renders the persistent sidebar; the hamburger then collapses
  // it to an icon rail instead of opening the drawer.
  const [desktop, setDesktop] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [memberships, setMemberships] = useState<MembershipOption[]>([]);
  const [recentOrgIds, setRecentOrgIds] = useState<string[]>([]);
  const [pathSearch, setPathSearch] = useState("");
  const [commandQuery, setCommandQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [commandCursor, setCommandCursor] = useState(0);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  // Rendered after mount so the server and client markup agree.
  const [shortcutHint, setShortcutHint] = useState("");
  const commandInputRef = useRef<HTMLInputElement>(null);
  const searchRequestId = useRef(0);
  const islandQueryOpened = useRef(false);
  const islandPressTimer = useRef<number | null>(null);
  const islandPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const islandLongPressed = useRef(false);

  const activeNav = findNavMatch(pathname);
  const activeGroupLabel = activeNav?.group.label;

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orgId") ?? "";
    setOrgId(id);
    document.body.classList.add("has-app-shell");
    return () => document.body.classList.remove("has-app-shell");
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle(
      "soft-nav-open",
      // The sidebar's workspace picker is not an overlay — it must not lock the page.
      open || commandOpen || accountMenuOpen || islandEditorOpen,
    );
    return () => document.body.classList.remove("soft-nav-open");
  }, [open, commandOpen, accountMenuOpen, islandEditorOpen]);

  useEffect(() => {
    setPathSearch(window.location.search);
  }, [pathname]);

  useEffect(() => {
    const media = window.matchMedia(SIDEBAR_MEDIA_QUERY);
    const sync = () => setDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    setSidebarCollapsed(readSidebarCollapsed());
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    return () => document.body.classList.remove("sidebar-collapsed");
  }, [sidebarCollapsed]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((value) => {
      writeSidebarCollapsed(!value);
      return !value;
    });
  }, []);

  useEffect(() => {
    setOpen(false);
    setCommandOpen(false);
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
    setWorkspaceOpen(false);
  }, [pathname]);

  useEffect(() => {
    setRecentOrgIds(listRecentOrgIds());
    setRecentCommands(listRecentCommands());
    const mac = /mac|iphone|ipad|ipod/i.test(window.navigator.platform || window.navigator.userAgent);
    setShortcutHint(mac ? "⌘K" : "Ctrl K");
  }, []);

  useEffect(() => {
    if (!commandOpen) {
      setCommandQuery("");
      setSearchHits([]);
      setSearchLoading(false);
      setCommandCursor(0);
      return;
    }
    setRecentCommands(listRecentCommands());
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
    setOpen(false);
    setIslandEditorOpen(true);
  }

  /**
   * The island promises "press and hold", and a phone has no right-click to fall
   * back to — so the hold has to be wired, without letting a scroll or a tap
   * become one.
   */
  function clearIslandPress() {
    if (islandPressTimer.current !== null) {
      window.clearTimeout(islandPressTimer.current);
      islandPressTimer.current = null;
    }
    islandPressOrigin.current = null;
  }

  function startIslandPress(event: React.PointerEvent<HTMLElement>) {
    // Right-click keeps travelling the onContextMenu path.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearIslandPress();
    islandLongPressed.current = false;
    islandPressOrigin.current = { x: event.clientX, y: event.clientY };
    islandPressTimer.current = window.setTimeout(() => {
      islandPressTimer.current = null;
      islandPressOrigin.current = null;
      islandLongPressed.current = true;
      openIslandEditor();
    }, 450);
  }

  function trackIslandPress(event: React.PointerEvent<HTMLElement>) {
    const origin = islandPressOrigin.current;
    if (!origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) clearIslandPress();
  }

  useEffect(
    () => () => {
      if (islandPressTimer.current !== null) window.clearTimeout(islandPressTimer.current);
    },
    [],
  );

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
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setOpen(false);
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
  // Prefer given name / email for the avatar glyph — never brand "V" from Vantage org naming.
  const initialSource =
    me.firstName?.trim() ||
    me.displayName?.trim() ||
    me.name?.trim() ||
    me.email?.trim() ||
    null;
  const brandLike = /^(vantage|team\s*\d+)/i;
  const initialChar = (() => {
    if (!initialSource) return "?";
    if (brandLike.test(initialSource) && me.email?.trim()) {
      return me.email.trim()[0]!.toUpperCase();
    }
    if (brandLike.test(initialSource)) return "?";
    return initialSource[0]!.toUpperCase();
  })();
  const initial = initialChar;

  const hubAccess = me.hubAccess ?? null;
  const sponsorsAllowed = me.sponsorsAllowed;
  const navHrefAllowed = useCallback(
    (href: string) =>
      pathAllowedByHubAccess(href, hubAccess) && pathAllowedBySponsors(href, sponsorsAllowed),
    [hubAccess, sponsorsAllowed],
  );
  const visibleIslandCatalog = useMemo(
    () => ISLAND_TAB_CATALOG.filter((item) => navHrefAllowed(item.href)),
    [navHrefAllowed],
  );
  const shellHubs = useMemo(
    () => buildShellHubs({ pathname, search: pathSearch, activeGroupLabel, isAllowed: navHrefAllowed }),
    [activeGroupLabel, navHrefAllowed, pathSearch, pathname],
  );

  /**
   * Ranked destinations + verbs. Labels in the hub catalog are context-free
   * ("Forms", "Coverage"), so this matches over hub breadcrumbs and the words
   * teams actually use ("bumpers", "onshape", "clock in") — see command-search.
   */
  const paletteCatalog = useMemo(() => {
    const entries = commandCatalog();
    if (!me.platformAdmin) return entries;
    return [
      ...entries,
      {
        id: "platform-admin",
        label: "Global Team Manager",
        context: "Platform admin",
        href: "/admin",
        kind: "destination" as const,
        keywords: ["admin", "platform", "all teams", "provision"],
      },
    ];
  }, [me.platformAdmin]);

  const commandHits = useMemo(
    () =>
      searchCommands(commandQuery, paletteCatalog, {
        // Past ~8 rows a member is scanning rather than selecting.
        limit: 8,
        isAllowed: navHrefAllowed,
        recentHrefs: recentCommands,
      }),
    [commandQuery, navHrefAllowed, paletteCatalog, recentCommands],
  );

  const goToCommand = useCallback(
    (hit: CommandHit) => {
      setCommandOpen(false);
      setRecentCommands(rememberRecentCommand(hit.href));
      router.push(withOrgHref(hit.href, orgId || null));
    },
    [orgId, router],
  );

  useEffect(() => {
    setCommandCursor(0);
  }, [commandQuery]);

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
    pathname === "/media" ||
    pathname === "/build" ||
    pathname === "/ai" ||
    pathname === "/logistics";

  const showBack =
    !isHubRoot &&
    (pathname.startsWith("/account") ||
      pathname.startsWith("/team/") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/security") ||
      pathname.startsWith("/notifications") ||
      pathname.startsWith("/docs") ||
      pathname.startsWith("/help") ||
      pathname === "/support");

  const backHref = useMemo(() => {
    if (pathname.startsWith("/account")) return "/dashboard";
    if (pathname.startsWith("/security")) return "/account";
    if (pathname === "/support") return "/docs";
    if (pathname.startsWith("/docs/") || pathname === "/docs" || pathname.startsWith("/help/") || pathname === "/help") {
      return pathname === "/docs" || pathname === "/help" ? "/dashboard" : "/docs";
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
          : pathname.startsWith("/docs") || pathname.startsWith("/help")
            ? "App manual"
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
  const eventFocus = useMemo(() => buildEventFocus(myDayGlance, online), [myDayGlance, online]);
  const islandTabs = useMemo(
    () => resolveIslandTabs(islandHrefs).filter((tab) => navHrefAllowed(tab.href)),
    [islandHrefs, navHrefAllowed],
  );
  const activeIslandTabHref = useMemo(
    () => activeIslandHref(pathname, pathSearch, islandTabs),
    [islandTabs, pathname, pathSearch],
  );

  useEffect(() => {
    document.body.classList.toggle("has-event-focus", Boolean(eventFocus && !focusCollapsed));
    return () => document.body.classList.remove("has-event-focus");
  }, [eventFocus, focusCollapsed]);

  const closeOverlays = useCallback(() => {
    setOpen(false);
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

  /**
   * One ordered list so ↑/↓ crosses both groups. Destinations resolve locally
   * and stay put; async data hits append underneath rather than reshuffling
   * the row under the cursor mid-keystroke.
   */
  const paletteRows = useMemo(
    () => [
      ...commandHits.map((hit) => ({ kind: "command" as const, href: hit.href, hit })),
      ...searchHits.map((hit) => ({ kind: "data" as const, href: hit.href, hit })),
    ],
    [commandHits, searchHits],
  );

  const activeRowIndex = paletteRows.length
    ? Math.min(commandCursor, paletteRows.length - 1)
    : -1;

  const openPaletteRow = useCallback(
    (index: number) => {
      const row = paletteRows[index];
      if (!row) {
        openFullSearch();
        return;
      }
      if (row.kind === "command") {
        goToCommand(row.hit);
        return;
      }
      setCommandOpen(false);
      setRecentCommands(rememberRecentCommand(row.href));
      router.push(row.href);
    },
    [goToCommand, openFullSearch, paletteRows, router],
  );

  const jumpCommandTopResult = useCallback(() => {
    if (activeRowIndex < 0) {
      openFullSearch();
      return;
    }
    openPaletteRow(activeRowIndex);
  }, [activeRowIndex, openFullSearch, openPaletteRow]);

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

  const ownerAdmin = me.role === "owner" || me.role === "admin";
  const quickActions = useMemo(
    () => shellQuickActions({ eventLive: Boolean(eventFocus), unreadMessages, isAllowed: navHrefAllowed }),
    [eventFocus, navHrefAllowed, unreadMessages],
  );
  const shellRecents = useMemo(
    () => resolveShellRecents(recentCommands, navHrefAllowed),
    [navHrefAllowed, recentCommands],
  );
  const shellNavProps = {
    hubs: shellHubs,
    quickActions,
    recents: shellRecents,
    orgId,
    orgLabel,
    roleCue: rolePlanCue,
    memberships: orderedMemberships,
    membershipLabel: formatMembershipLabel,
    switchWorkspaceHref,
    onWorkspaceSwitch,
    workspaceOpen,
    onToggleWorkspace: () => setWorkspaceOpen((value) => !value),
    accountLabel: accountLabel ?? "Account",
    initial,
    image: me.image,
    platformAdmin: Boolean(me.platformAdmin),
    ownerAdmin,
    shortcutHint,
    signingOut,
    onNavigate: () => {
      setOpen(false);
      setWorkspaceOpen(false);
    },
    onOpenSearch: () => {
      setOpen(false);
      setCommandOpen(true);
    },
    onOpenIslandEditor: () => openIslandEditor(),
    onSignOut: () => void handleSignOut(),
  };

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
              if (desktop) {
                toggleSidebar();
                return;
              }
              setOpen((value) => !value);
            }}
          >
            <span className="soft-burger" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
          <div className="soft-page-head">
            {showBack ? (
              <button
                className="soft-icon-btn"
                type="button"
                aria-label="Go back"
                onClick={() => router.push(backHref)}
              >
                <Icon name="back" />
              </button>
            ) : null}
            <div className="soft-page-head-copy">
              <p className="soft-topbar-title">{title ?? "Vantage"}</p>
              <small className="soft-org-crumb">{showBack ? crumbHint : orgLabel}</small>
            </div>
          </div>
        </div>
        <div className="soft-topbar-actions">
          <ShellOutboxStatus orgId={orgId || null} />
          <button
            className="soft-icon-btn soft-search-btn"
            type="button"
            aria-label="Search and jump to anything"
            aria-keyshortcuts="Control+K Meta+K"
            onClick={() => {
              setCommandOpen(true);
            }}
          >
            <Icon name="search" />
            <span className="soft-search-label">Search</span>
            {/* Nobody discovers ⌘K unless it is on screen. */}
            <kbd className="soft-search-kbd" aria-hidden="true">
              {shortcutHint}
            </kbd>
          </button>
          {/* One-tap light/dark next to the bell; the full Light / Dark / System choice stays under Appearance. */}
          <span className="soft-theme-slot">
            <ThemeToggle />
          </span>
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
                  Settings
                </a>
                <a role="menuitem" href="/account?tab=appearance" onClick={() => setAccountMenuOpen(false)}>
                  Appearance
                </a>
                <a role="menuitem" href="/security" onClick={() => setAccountMenuOpen(false)}>
                  Security
                </a>
                <a role="menuitem" href="/docs" onClick={() => setAccountMenuOpen(false)}>
                  App manual
                </a>
                <a role="menuitem" href="/support" onClick={() => setAccountMenuOpen(false)}>
                  Support tickets
                </a>
                <a role="menuitem" href="/report-bug" onClick={() => setAccountMenuOpen(false)}>
                  Report a bug
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
      <aside className={`soft-drawer shell-drawer ${open ? "open" : ""}`} aria-label="Product navigation">
        <ShellNav variant="drawer" {...shellNavProps} onClose={() => setOpen(false)} />
      </aside>
      <nav className={`shell-sidebar${sidebarCollapsed ? " is-collapsed" : ""}`} aria-label="Product navigation sidebar">
        <ShellNav
          variant="sidebar"
          collapsed={sidebarCollapsed}
          {...shellNavProps}
          onToggleCollapsed={toggleSidebar}
        />
      </nav>

      <nav
        className="soft-island"
        data-testid="soft-island"
        aria-label="Primary apps"
        title="Press and hold or right-click to change these four apps"
        onContextMenu={(event) => {
          event.preventDefault();
          openIslandEditor();
        }}
        onPointerDown={startIslandPress}
        onPointerMove={trackIslandPress}
        onPointerUp={clearIslandPress}
        onPointerCancel={clearIslandPress}
        onPointerLeave={clearIslandPress}
        onClickCapture={(event) => {
          if (!islandLongPressed.current) return;
          islandLongPressed.current = false;
          // Keyboard activation is never the hold's own click, so let it through.
          if (event.detail === 0) return;
          // The hold already opened the editor — don't also follow the tab link.
          event.preventDefault();
          event.stopPropagation();
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
      </nav>

      {islandEditorOpen ? (
        <div className="soft-island-editor" role="dialog" aria-modal="true" aria-labelledby="island-editor-title">
          <button className="soft-island-editor-scrim" type="button" aria-label="Close island customization" onClick={() => setIslandEditorOpen(false)} />
          <section>
            <header>
              <div>
                <span>BOTTOM ISLAND</span>
                <h2 id="island-editor-title">Four apps</h2>
                <p>Home, Compete, Team, and Business by default. Long-press the island or use the menu to change them.</p>
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
            <p className="soft-island-order-hint">Tap apps in the order you want them. Tap a selected app to remove it.</p>
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
                    <Icon name={item.icon} /><span><strong>{item.label}</strong><small>{selected ? `Slot ${islandDraft.indexOf(item.href) + 1}` : "Add"}</small></span>
                  </button>
                );
              })}
            </div>
            {islandMessage ? <p className="soft-island-editor-error" role="alert">{islandMessage}</p> : null}
            <footer>
              <button type="button" onClick={() => setIslandDraft(defaultIslandHrefs())}>Reset</button>
              <button className="primary" type="button" disabled={islandDraft.length !== 4 || islandSaving} onClick={() => void saveIsland()}>
                {islandSaving ? "Saving…" : `Save ${islandDraft.length}/4`}
              </button>
            </footer>
          </section>
        </div>
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
              Go to any tool, or search your tasks, inventory, impact, and knowledge
              <input
                id="soft-command-input"
                ref={commandInputRef}
                type="search"
                role="combobox"
                aria-expanded={paletteRows.length > 0}
                aria-controls="soft-command-results"
                aria-activedescendant={
                  activeRowIndex >= 0 ? `soft-command-row-${activeRowIndex}` : undefined
                }
                value={commandQuery}
                placeholder="Search for anything — try “bumpers”, “clock in”, “pick list”"
                autoComplete="off"
                onChange={(event) => setCommandQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    if (paletteRows.length) {
                      setCommandCursor((current) => (current + 1) % paletteRows.length);
                    }
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    if (paletteRows.length) {
                      setCommandCursor(
                        (current) => (current - 1 + paletteRows.length) % paletteRows.length,
                      );
                    }
                    return;
                  }
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
            <div id="soft-command-results" role="listbox" aria-label="Results">
              {commandHits.length > 0 ? (
                <nav className="command-group" aria-label="Go to">
                  <p className="command-group-head">
                    {commandQuery.trim() ? "Go to" : recentCommands.length ? "Recent" : "Jump to"}
                  </p>
                  {commandHits.map((hit, index) => (
                    <a
                      id={`soft-command-row-${index}`}
                      role="option"
                      aria-selected={index === activeRowIndex}
                      className={index === activeRowIndex ? "is-active" : undefined}
                      href={withOrgHref(hit.href, orgId)}
                      key={hit.id}
                      onMouseEnter={() => setCommandCursor(index)}
                      onClick={(event) => {
                        event.preventDefault();
                        goToCommand(hit);
                      }}
                    >
                      <Icon name={hit.kind === "action" ? "bolt" : "grid"} />
                      <span>
                        {hit.label}
                        <small>{hit.context}</small>
                      </span>
                      {index === activeRowIndex ? <small aria-hidden="true">↵</small> : null}
                    </a>
                  ))}
                </nav>
              ) : null}

              {!commandQuery.trim() && quickActions.length > 0 ? (
                <nav className="command-group command-suggested" aria-label="Suggested">
                  <p className="command-group-head">Suggested now</p>
                  {quickActions.slice(0, 3).map((action) => (
                    <a
                      key={action.id}
                      href={withOrgHref(action.href, orgId)}
                      onClick={(event) => {
                        event.preventDefault();
                        setCommandOpen(false);
                        setRecentCommands(rememberRecentCommand(action.href));
                        router.push(withOrgHref(action.href, orgId || null));
                      }}
                    >
                      <Icon name={action.icon} />
                      <span>
                        {action.label}
                        <small>{eventFocus ? "Event day" : "Today"}</small>
                      </span>
                    </a>
                  ))}
                </nav>
              ) : null}

              {searchHits.length > 0 || searchLoading ? (
                <section className="command-search-hits" aria-label="Your data">
                  <header>
                    <strong>In your team&apos;s data</strong>
                    {searchLoading ? <small>Searching…</small> : null}
                  </header>
                  <nav>
                    {searchHits.map((hit, offset) => {
                      const index = commandHits.length + offset;
                      return (
                        <a
                          id={`soft-command-row-${index}`}
                          role="option"
                          aria-selected={index === activeRowIndex}
                          className={index === activeRowIndex ? "is-active" : undefined}
                          href={hit.href}
                          key={`${hit.href}-${hit.title}`}
                          onMouseEnter={() => setCommandCursor(index)}
                          onClick={() => setCommandOpen(false)}
                        >
                          <Icon name="search" />
                          <span>
                            {hit.title}
                            {hit.subtitle ? <small>{hit.subtitle}</small> : null}
                          </span>
                          {hit.sourceLabel ? <small>{hit.sourceLabel}</small> : null}
                        </a>
                      );
                    })}
                  </nav>
                  <button type="button" className="command-open-full" onClick={openFullSearch}>
                    Open full search{commandQuery.trim() ? ` for “${commandQuery.trim()}”` : ""}
                  </button>
                </section>
              ) : null}

              {paletteRows.length === 0 && !searchLoading ? (
                <p className="command-empty">
                  Nothing matches “{commandQuery.trim()}”. Press Ctrl/⌘+Enter to search your data.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export { Icon };
export type { IconName };
