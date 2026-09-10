"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShellOutboxStatus } from "./shell-outbox-status";
import {
  ISLAND_TAB_CATALOG,
  LOGISTICS_DEEP_LINKS,
  ORG_EXEMPT_HREFS,
  PRODUCT_NAV_GROUPS,
  breadcrumbForPath,
  findNavMatch,
  navTitleForPath,
  withOrgHref,
  withSelectedOrgHref,
  type ProductNavGroup,
} from "../lib/nav/product-nav";
import { navHubByLabel } from "../lib/nav/hubs";
import { defaultIslandHrefs, resolveIslandTabs } from "../lib/nav/island-preferences";
import {
  pathAllowedByHubAccess,
  pathAllowedBySponsors,
  type ClientHubAccessRow,
} from "../lib/nav/hub-access-filter";
import { listRecentOrgIds, rememberRecentOrg, sortMembershipsByRecent } from "../lib/nav/recent-teams";
import { commandCatalog, searchCommands, type CommandHit } from "../lib/nav/command-search";
import { listRecentCommands, rememberRecentCommand } from "../lib/nav/recent-commands";
import { fetchProductSession } from "../lib/nav/product-session";
import { Icon, type IconName } from "./icon";
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

const groups = PRODUCT_NAV_GROUPS;

/**
 * Sub-links the panel has to carry itself.
 *
 * Every hub with a `ProductHubDef` renders its own section tab bar on the page,
 * so repeating those sections here put the same four labels on screen twice
 * (drawer "Event day / Scouting / Strategy / Pit" beside the page's own tab bar
 * saying the same thing). The panel now defers to the page for those.
 *
 * Logistics is the one pillar with no in-page tab bar, so Packing / Duties /
 * Visit invites would have no browsable home at all — they stay here.
 */
function panelSubLinks(group: ProductNavGroup): Array<{ href: string; label: string }> {
  if (navHubByLabel(group.label)) return [];
  if (group.label !== "Logistics") return [];
  return LOGISTICS_DEEP_LINKS.map((item) => ({ href: item.href, label: item.label }));
}

function formatMembershipLabel(row: MembershipOption): string {
  const team =
    row.teamNumber != null && Number.isFinite(row.teamNumber) ? `Team ${row.teamNumber}` : null;
  const name = row.orgName?.trim() || null;
  const parts = [team, name].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Your team";
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
  return "Your team";
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
  /**
   * One overlay for navigation *and* search. There used to be two — a drawer of
   * destinations behind the hamburger and a command dialog of the same
   * destinations behind ⌘K — which is why the same page could be reached from
   * four controls at once.
   */
  const [navOpen, setNavOpen] = useState(false);
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
  const [pathSearch, setPathSearch] = useState("");
  const [navQuery, setNavQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [resultCursor, setResultCursor] = useState(0);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  // Rendered after mount so the server and client markup agree.
  const [shortcutHint, setShortcutHint] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelCloseRef = useRef<HTMLButtonElement>(null);
  const searchRequestId = useRef(0);
  const islandQueryOpened = useRef(false);
  const islandPressTimer = useRef<number | null>(null);
  const islandPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const islandLongPressed = useRef(false);
  /** Set by the search entry points so opening from "All" never pops a keyboard. */
  const focusSearchOnOpen = useRef(false);

  const activeNav = findNavMatch(pathname);
  const activeGroupLabel = activeNav?.group.label;

  const openNav = useCallback((options?: { focusSearch?: boolean }) => {
    focusSearchOnOpen.current = Boolean(options?.focusSearch);
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
    setNavOpen(true);
  }, []);

  const closeNav = useCallback(() => {
    setNavOpen(false);
    setWorkspaceOpen(false);
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orgId") ?? "";
    setOrgId(id);
    document.body.classList.add("has-app-shell");
    return () => document.body.classList.remove("has-app-shell");
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle(
      "soft-nav-open",
      navOpen || accountMenuOpen || islandEditorOpen,
    );
    // The island lists four of the same apps the panel lists. Only one of the
    // two is on screen at a time.
    document.body.classList.toggle("soft-nav-panel-open", navOpen);
    return () => {
      document.body.classList.remove("soft-nav-open");
      document.body.classList.remove("soft-nav-panel-open");
    };
  }, [navOpen, accountMenuOpen, islandEditorOpen]);

  useEffect(() => {
    setPathSearch(window.location.search);
  }, [pathname]);

  useEffect(() => {
    setNavOpen(false);
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
    setWorkspaceOpen(false);
  }, [pathname]);

  useEffect(() => {
    setRecentOrgIds(listRecentOrgIds());
    const mac = /mac|iphone|ipad|ipod/i.test(window.navigator.platform || window.navigator.userAgent);
    setShortcutHint(mac ? "⌘K" : "Ctrl K");
  }, []);

  useEffect(() => {
    if (!navOpen) {
      setNavQuery("");
      setSearchHits([]);
      setSearchLoading(false);
      setResultCursor(0);
      return;
    }
    setRecentCommands(listRecentCommands());
    const wantsSearch = focusSearchOnOpen.current;
    focusSearchOnOpen.current = false;
    const focusTimer = window.setTimeout(() => {
      if (wantsSearch) searchInputRef.current?.focus();
      else panelCloseRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(focusTimer);
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen) return;
    const q = navQuery.trim();
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
  }, [navOpen, navQuery, orgId]);

  useEffect(() => {
    void fetchProductSession(orgId || null)
      .then((data) => {
        if (!data) return;
        setMe(data as Me);
        const rows = (Array.isArray(data.memberships) ? data.memberships : []).filter(
          (row): row is MembershipOption => Boolean(row?.orgId),
        );
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
    setNavOpen(false);
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
        openNav({ focusSearch: true });
      }
      if (event.key === "Escape") {
        setNavOpen(false);
        setAccountMenuOpen(false);
        setIslandEditorOpen(false);
        setWorkspaceOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNav]);

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
  const visibleNavGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => navHrefAllowed(item.href)),
        }))
        .filter((group) => group.items.length > 0),
    [navHrefAllowed],
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

  const queryActive = navQuery.trim().length > 0;

  const commandHits = useMemo(
    () =>
      queryActive
        ? searchCommands(navQuery, paletteCatalog, {
            // Past ~8 rows a member is scanning rather than selecting.
            limit: 8,
            isAllowed: navHrefAllowed,
            recentHrefs: recentCommands,
          })
        : [],
    [navQuery, navHrefAllowed, paletteCatalog, queryActive, recentCommands],
  );

  const goToCommand = useCallback(
    (hit: CommandHit) => {
      closeNav();
      setRecentCommands(rememberRecentCommand(hit.href));
      router.push(withOrgHref(hit.href, orgId || null));
    },
    [closeNav, orgId, router],
  );

  useEffect(() => {
    setResultCursor(0);
  }, [navQuery]);

  const orderedMemberships = useMemo(
    () => sortMembershipsByRecent(memberships, recentOrgIds),
    [memberships, recentOrgIds],
  );

  /** Hub roots own the page title, so Back would strand a member on them. */
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
      : (me.orgName ?? (orgId ? "This team" : "No team selected"));
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
    setNavOpen(false);
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
    const q = navQuery.trim();
    const href = withOrgHref(q ? `/search?q=${encodeURIComponent(q)}` : "/search", orgId || null);
    closeNav();
    router.push(href);
  }, [closeNav, navQuery, orgId, router]);

  /**
   * One ordered list so ↑/↓ crosses both groups. Destinations resolve locally
   * and stay put; async data hits append underneath rather than reshuffling
   * the row under the cursor mid-keystroke.
   */
  const resultRows = useMemo(
    () => [
      ...commandHits.map((hit) => ({ kind: "command" as const, href: hit.href, hit })),
      ...searchHits.map((hit) => ({ kind: "data" as const, href: hit.href, hit })),
    ],
    [commandHits, searchHits],
  );

  const activeRowIndex = resultRows.length ? Math.min(resultCursor, resultRows.length - 1) : -1;

  const openResultRow = useCallback(
    (index: number) => {
      const row = resultRows[index];
      if (!row) {
        openFullSearch();
        return;
      }
      if (row.kind === "command") {
        goToCommand(row.hit);
        return;
      }
      closeNav();
      setRecentCommands(rememberRecentCommand(row.href));
      router.push(row.href);
    },
    [closeNav, goToCommand, openFullSearch, resultRows, router],
  );

  const jumpTopResult = useCallback(() => {
    if (activeRowIndex < 0) {
      openFullSearch();
      return;
    }
    openResultRow(activeRowIndex);
  }, [activeRowIndex, openFullSearch, openResultRow]);

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

  /**
   * The panel sits over a scrim, so the page behind it cannot be clicked — but
   * Tab still walked straight into it, handing a keyboard user controls their
   * mouse is not allowed to reach. Wrap at the panel's own boundary instead.
   */
  function keepTabInsidePanel(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const root = event.currentTarget;
    const focusable = [
      ...root.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    ].filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
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

  return (
    <>
      <a className="soft-skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className={`soft-topbar${accountMenuOpen ? " account-menu-open" : ""}`}>
        <div className={`soft-topbar-lead${showBack ? " has-back" : ""}`}>
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
              {isHubRoot ? (
                /* A hub root already names itself in its own H1, and its island
                   tab is lit — a third copy in the bar is noise. Show the one
                   thing the page cannot: whose workspace this is. */
                <p className="soft-topbar-title soft-topbar-org">{orgLabel}</p>
              ) : (
                <>
                  <p className="soft-topbar-title">{title ?? "Vantage"}</p>
                  <small className="soft-org-crumb">{showBack ? crumbHint : orgLabel}</small>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="soft-topbar-actions">
          <ShellOutboxStatus orgId={orgId || null} />
          {/* AI is a helper you reach from wherever you are, not a place you go.
              One control on every page; the chat itself lives at /ai and its
              settings under Settings, so this is the only AI entry in the chrome. */}
          <a
            className="soft-icon-btn soft-ask-ai"
            href={withOrgHref("/ai?tab=chat", orgId || null)}
            aria-label="Ask AI"
            title="Ask AI — strategy, match predictions, design help"
          >
            <Icon name="bolt" />
            <span className="soft-ask-ai-label">Ask AI</span>
          </a>
          {/* Wide screens get search in the bar; narrow ones reach the same field
              inside the panel, so there is exactly one search box per width. */}
          {navOpen ? null : (
            <button
              className="soft-icon-btn soft-search-btn"
              type="button"
              aria-label="Search Vantage"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => openNav({ focusSearch: true })}
            >
              <Icon name="search" />
              <span className="soft-search-label">Search</span>
              {/* Nobody discovers ⌘K unless it is on screen. */}
              <kbd className="soft-search-kbd" aria-hidden="true">
                {shortcutHint}
              </kbd>
            </button>
          )}
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
                  <div className="soft-account-teams" role="group" aria-label="Switch team">
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
                {/* Settings owns the canonical list (SETTINGS_NAV): profile,
                    appearance, notifications, security, keys. Repeating two of
                    its rows here meant this menu had two ways to /account. */}
                <a role="menuitem" href="/account" onClick={() => setAccountMenuOpen(false)}>
                  Settings
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

      {navOpen ? (
        <button className="soft-scrim" type="button" aria-label="Close navigation" onClick={closeNav} />
      ) : null}
      <aside
        className={`soft-drawer ${navOpen ? "open" : ""}`}
        aria-label="Product navigation"
        onKeyDown={navOpen ? keepTabInsidePanel : undefined}
      >
        <div className="soft-drawer-head">
          <div className="soft-drawer-brand">
            <span className="mark">v</span>
            <div>
              <strong>Vantage</strong>
            </div>
          </div>
          <button
            className="soft-icon-btn"
            type="button"
            aria-label="Close"
            ref={panelCloseRef}
            onClick={closeNav}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="soft-profile-block soft-profile-compact">
          <a className="soft-profile-link" href="/account" onClick={closeNav}>
            <span className="soft-avatar">
              {me.image ? (
                <img src={me.image} alt="" />
              ) : (
                initial
              )}
            </span>
            <div>
              <strong>{accountLabel ?? "Account"}</strong>
              {/* Who you are. The workspace chip directly below says which team
                  — printing the org on both lines said it twice. */}
              <span>{me.email ?? "Your account"}</span>
            </div>
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
                <span>{orgId ? rolePlanCue : "Pick a team"}</span>
              </div>
              <span className={`soft-nav-caret${workspaceOpen ? " open" : ""}`} aria-hidden="true">
                <Icon name="chevron" />
              </span>
            </button>
            {workspaceOpen ? (
              <div id="soft-workspace-picker" className="soft-workspace-picker" role="listbox" aria-label="Your teams">
                {memberships.length === 0 ? (
                  <p className="soft-workspace-empty">No team yet — open an invite from email.</p>
                ) : (
                  orderedMemberships.map((row) => (
                    <a
                      key={row.orgId}
                      role="option"
                      aria-selected={row.orgId === orgId}
                      href={switchWorkspaceHref(row.orgId)}
                      onClick={() => {
                        onWorkspaceSwitch(row.orgId);
                        closeNav();
                      }}
                    >
                      <strong>{formatMembershipLabel(row)}</strong>
                      <span>
                        {row.role ?? "member"}
                        {row.orgId === orgId ? " · active" : ""}
                      </span>
                    </a>
                  ))
                )}
                <div className="soft-workspace-links">
                  <a href={withOrgHref("/workspace", orgId)} onClick={closeNav}>
                    Manage teams
                  </a>
                  <a href="/invite" onClick={closeNav}>
                    Invite
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* The one search box. It used to be a button here that opened a second
            overlay listing the same destinations this panel already lists. */}
        <div className="soft-panel-search">
          <Icon name="search" />
          <input
            id="soft-nav-search"
            ref={searchInputRef}
            type="search"
            role="combobox"
            aria-label="Search pages, tools, and your team's data"
            aria-expanded={resultRows.length > 0}
            aria-controls={queryActive ? "soft-nav-results" : undefined}
            aria-activedescendant={activeRowIndex >= 0 ? `soft-nav-row-${activeRowIndex}` : undefined}
            value={navQuery}
            placeholder="Search Vantage"
            autoComplete="off"
            onChange={(event) => setNavQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (resultRows.length) {
                  setResultCursor((current) => (current + 1) % resultRows.length);
                }
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                if (resultRows.length) {
                  setResultCursor((current) => (current - 1 + resultRows.length) % resultRows.length);
                }
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.metaKey || event.ctrlKey) {
                  openFullSearch();
                  return;
                }
                jumpTopResult();
              }
            }}
          />
          {navQuery ? (
            <button
              type="button"
              className="soft-panel-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setNavQuery("");
                searchInputRef.current?.focus();
              }}
            >
              <Icon name="x" />
            </button>
          ) : shortcutHint ? (
            <kbd aria-hidden="true">{shortcutHint}</kbd>
          ) : null}
        </div>

        {queryActive ? (
          <div id="soft-nav-results" className="soft-nav-results" role="listbox" aria-label="Search results">
            {commandHits.length > 0 ? (
              <nav className="command-group" aria-label="Go to">
                <p className="command-group-head">Go to</p>
                {commandHits.map((hit, index) => (
                  <a
                    id={`soft-nav-row-${index}`}
                    role="option"
                    aria-selected={index === activeRowIndex}
                    className={index === activeRowIndex ? "is-active" : undefined}
                    href={withOrgHref(hit.href, orgId)}
                    key={hit.id}
                    onMouseEnter={() => setResultCursor(index)}
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
                        id={`soft-nav-row-${index}`}
                        role="option"
                        aria-selected={index === activeRowIndex}
                        className={index === activeRowIndex ? "is-active" : undefined}
                        href={hit.href}
                        key={`${hit.href}-${hit.title}`}
                        onMouseEnter={() => setResultCursor(index)}
                        onClick={closeNav}
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
                  Open full search for “{navQuery.trim()}”
                </button>
              </section>
            ) : null}

            {resultRows.length === 0 && !searchLoading ? (
              <p className="command-empty">
                Nothing matches “{navQuery.trim()}”. Press Ctrl/⌘+Enter to search your data.
              </p>
            ) : null}
          </div>
        ) : (
          <nav className="soft-drawer-flat" aria-label="Hubs">
            {visibleNavGroups.map((group) => {
              const item = group.items[0];
              if (!item || item.state === "planned") return null;
              const isActive = activeGroupLabel === group.label;
              const sub = panelSubLinks(group).filter((entry) => navHrefAllowed(entry.href));
              // Hue only. The plate and the ink are derived per theme in
              // system.css, so nothing light-only crosses into an inline style.
              const toneStyle = { ["--tone" as string]: group.tone };
              return (
                <div key={group.label} className="soft-nav-group" style={toneStyle}>
                  {/* One row, one destination. The hub's own tab bar lists its
                      sections once the member is there. */}
                  <a
                    className={`soft-drawer-hub${isActive ? " is-active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    href={withOrgHref(item.href, orgId)}
                    onClick={closeNav}
                  >
                    <i>
                      <Icon name={group.icon} />
                    </i>
                    <span>{item.label}</span>
                  </a>
                  {sub.length > 0 ? (
                    <div className="soft-nav-items">
                      {sub.map((entry) => (
                        <a
                          key={entry.href}
                          href={withOrgHref(entry.href, orgId)}
                          aria-current={pathname === (entry.href.split("?")[0] ?? entry.href) ? "page" : undefined}
                          onClick={closeNav}
                        >
                          {entry.label}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {me.platformAdmin ? (
              <a className="soft-drawer-hub soft-drawer-platform" href="/admin" onClick={closeNav}>
                <i>
                  <Icon name="grid" />
                </i>
                <span>Team manager</span>
              </a>
            ) : null}
          </nav>
        )}
        <footer className="soft-drawer-foot">
          <button type="button" onClick={() => openIslandEditor()}>
            Customize island
          </button>
          <button type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </footer>
      </aside>

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
        {/* The only control that opens the navigation panel. */}
        <button
          type="button"
          className="soft-island-more"
          aria-label="Open all apps"
          aria-expanded={navOpen}
          onClick={() => openNav()}
        >
          <Icon name="grid" />
          <span>All</span>
        </button>
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
    </>
  );
}

export { Icon };
export type { IconName };
