"use client";

import "../app/product-styles";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShellNavPanel } from "./app-shell-nav-panel";
import { AppShellEventFocus, AppShellIsland } from "./app-shell-island";
import { AppShellSearchPalette } from "./app-shell-search-palette";
import { AppShellPinsEditor } from "./app-shell-pins-editor";
import { useShellSearch } from "./use-shell-search";
import { AppTour } from "./app-tour";
import { FeedbackButton } from "./feedback-button";
import { StatusEcho } from "./status-echo";
import { LegalUpdateBanner } from "./legal-update-banner";
import { ServiceNoticeBanner } from "./service-notice-banner";
import { useSheetsAutoSync } from "./use-sheets-auto-sync";
import { AppShellTopbar } from "./app-shell-topbar";
import { AppShellSidebar } from "./app-shell-sidebar";
import {
  PRODUCT_NAV_GROUPS,
  breadcrumbForPath,
  findNavMatch,
  withOrgHref,
} from "../lib/nav/product-nav";
import { BAR_SLOTS, PINS_CHANGED_EVENT, PINS_EDIT_EVENT, defaultPinHrefs, pinCatalog, resolvePins, resolveStoredPins } from "../lib/nav/pins";
import {
  pathAllowedByHubAccess,
  pathAllowedBySponsors,
} from "../lib/nav/hub-access-filter";
import { listRecentOrgIds, rememberRecentOrg, sortMembershipsByRecent } from "../lib/nav/recent-teams";
import { commandCatalogFor } from "../lib/nav/command-search";
import { isSettingsPath, settingsRoleTier } from "../lib/nav/settings-nav";
import { pushAppNavigation, softNavigationTarget } from "../lib/nav/soft-navigation";
import { fetchProductSession } from "../lib/nav/product-session";
import { pathnameIsEntryScreen } from "../lib/nav/product-route";
import { probeSessionUser } from "../lib/nav/session-probe";
import { Icon, type IconName } from "./icon";
import { type MyDayView } from "../lib/my-day";
import { buildEventFocus } from "../lib/event-focus";
import { signOutAndRedirect } from "../lib/sign-out";
import { NOTIFICATIONS_CHANGED, type NotificationCountUpdate } from "../lib/notifications/events";
import { listenInboxUpdates } from "../lib/notifications/inbox-events";
import { watchSessionBoundary } from "../lib/offline/identity";
import { pathnameIsBareShell } from "../lib/nav/shell-body-class";
import { workspacePickerHref } from "../lib/workspace";
import { URL_CHANGE_EVENT } from "../lib/nav/url-change";
import { NextActionsDedupe } from "./next-actions-dedupe";
import {
  accountInitialFor,
  accountLabelFor,
  activeIslandHref,
  backHrefForPath,
  filterVisibleNavGroups,
  formatRolePlanCue,
  isHubRootPath,
  readRememberedTeamLabel,
  rememberTeamLabel,
  shellOrgLabel,
  teamLabelFor,
  shellTitleForPath,
  showBackForPath,
  switchWorkspaceHrefFor,
  type Me,
  type MembershipOption,
} from "./app-shell-model";

const groups = PRODUCT_NAV_GROUPS;

/** localStorage, or null where the browser blocks it (private mode, blocked site data). */
function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function AppShell() {
  const pathname = usePathname();
  const router = useRouter();
  /**
   * Sign-in, invites, join-by-code and onboarding: the person is signed out or has not finished
   * their profile, so /api/me, /api/navigation/preferences and /api/legal answer 401/403 there.
   * The account chip only needs who is signed in, which the auth route answers.
   */
  const entryScreen = pathnameIsEntryScreen(pathname);
  const [orgId, setOrgId] = useState("");
  // The team's spreadsheets follow the app on their own: no Sync button to remember.
  useSheetsAutoSync(orgId);
  /**
   * The menu (phones and tablets: the hamburger and the bottom bar's More) is for going
   * places, with its own search field. ⌘K / Ctrl+K and the top bar's "Search anything" open
   * the search palette instead: one field, centered, on every screen size. Desktop already has
   * the sidebar, so search never opens a second navigation menu on top of it.
   */
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try { setSidebarCollapsed(localStorage.getItem("vantage.sidebar.collapsed") === "true"); } catch { /* Device preference is optional. */ }
  }, []);
  useEffect(() => {
    document.body.classList.toggle("shell-sidebar-collapsed", sidebarCollapsed);
    return () => document.body.classList.remove("shell-sidebar-collapsed");
  }, [sidebarCollapsed]);
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try { localStorage.setItem("vantage.sidebar.collapsed", String(next)); } catch { /* Still works for this visit. */ }
  };
  const [me, setMe] = useState<Me>({});
  const [rememberedTeamLabel, setRememberedTeamLabel] = useState<string | null>(null);
  useEffect(() => {
    const label = teamLabelFor(me.teamNumber, me.orgName);
    const id = me.orgId ?? "";
    if (label && id) rememberTeamLabel(safeLocalStorage(), id, label);
  }, [me.orgId, me.orgName, me.teamNumber]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const notificationRevision = useRef(0);
  const [signingOut, setSigningOut] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [myDayGlance, setMyDayGlance] = useState<MyDayView | null>(null);
  const [online, setOnline] = useState(true);
  const [focusCollapsed, setFocusCollapsed] = useState(false);
  /** "Your apps": the bottom bar shows the first four; the menu and the sidebar show them all. */
  const [pinHrefs, setPinHrefs] = useState<string[]>(defaultPinHrefs);
  const [islandEditorOpen, setIslandEditorOpen] = useState(false);
  const [memberships, setMemberships] = useState<MembershipOption[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [recentOrgIds, setRecentOrgIds] = useState<string[]>([]);
  const [pathSearch, setPathSearch] = useState("");
  const [shortcutHint, setShortcutHint] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelCloseRef = useRef<HTMLButtonElement>(null);
  const islandQueryOpened = useRef(false);
  // A save that lands wins over a late-arriving read of the old pins.
  const pinsRevision = useRef(0);
  const islandPressTimer = useRef<number | null>(null);
  const islandPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const islandLongPressed = useRef(false);
  const focusSearchOnOpen = useRef(false);
  const navOpenerRef = useRef<HTMLElement | null>(null);
  /** Focus goes back only after a real close, never on the first render. */
  const navWasOpenRef = useRef(false);
  /** Bumps when the URL changes without a pathname change (?orgId=, ?tab=), so query-driven state follows soft navigations. */
  const [locationTick, setLocationTick] = useState(0);

  const activeNav = findNavMatch(pathname);
  // Another person signing in on this device (another tab) ends this tab's session view.
  useEffect(() => { watchSessionBoundary(); }, []);
  const activeGroupLabel = activeNav?.group.label;

  const openNav = useCallback((options?: { focusSearch?: boolean }) => {
    if (!document.activeElement?.closest(".soft-drawer")) {
      // Ctrl/⌘+K from the page itself has <body> as the "opener"; focusing that again on close
      // dropped keyboard users at the top of the document. null sends focus to the search button.
      const active = document.activeElement;
      navOpenerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    focusSearchOnOpen.current = Boolean(options?.focusSearch);
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
    setPaletteOpen(false);
    setNavOpen(true);
  }, []);

  const closeNav = useCallback(() => {
    setNavOpen(false);
  }, []);

  /** ⌘K / Ctrl+K and "Search anything": the search palette, never the menu. */
  const openPalette = useCallback(() => {
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
    setNavOpen(false);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  /** Touch opens navigation without bringing up the software keyboard. */
  const toggleMenu = useCallback(() => {
    openNav({ focusSearch: !window.matchMedia("(pointer: coarse)").matches });
  }, [openNav]);

  const navigate = useCallback((href: string) => {
    pushAppNavigation((path) => router.push(path), href);
  }, [router]);

  // Plain in-app links navigate without reloading the app (lib/nav/soft-navigation.ts).
  // On document, bubble phase: runs after React's handlers, so next/link clicks it
  // already handled arrive with defaultPrevented and are skipped.
  useEffect(() => {
    let routerReady = false;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const path = softNavigationTarget(
        event,
        {
          href: anchor.getAttribute("href") ?? "",
          target: anchor.getAttribute("target") ?? "",
          hasDownload: anchor.hasAttribute("download"),
          rel: anchor.getAttribute("rel") ?? "",
          fullReload: Boolean(anchor.closest("[data-full-reload]")),
        },
        new URL(window.location.href),
      );
      // In the first moments after load the router may not be ready yet ("Router action
      // dispatched before initialization"); let those early clicks load normally.
      if (!path || !routerReady) return;
      event.preventDefault();
      navigate(path);
    };
    const onPop = () => setLocationTick((tick) => tick + 1);
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPop);
    // A hub switching tabs in place rewrites the address without navigating.
    window.addEventListener(URL_CHANGE_EVENT, onPop);
    const readyTimer = window.setTimeout(() => {
      routerReady = true;
    }, 300);
    return () => {
      window.clearTimeout(readyTimer);
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener(URL_CHANGE_EVENT, onPop);
    };
  }, [navigate]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orgId") ?? "";
    setOrgId(id);
    // Same render as the team id, so the label goes straight from the placeholder to the name
    // this device last showed for the team.
    setRememberedTeamLabel(readRememberedTeamLabel(safeLocalStorage(), id));
    // has-app-shell, shell-bare and shell-onboarding are on <body> in the server HTML
    // (components/app-body.tsx), so the first paint is already this frame.
  }, [pathname, locationTick]);

  useEffect(() => {
    document.body.classList.toggle(
      "soft-nav-open",
      navOpen || accountMenuOpen || islandEditorOpen || paletteOpen,
    );
    document.body.classList.toggle("soft-nav-panel-open", navOpen);
    return () => {
      document.body.classList.remove("soft-nav-open");
      document.body.classList.remove("soft-nav-panel-open");
    };
  }, [navOpen, accountMenuOpen, islandEditorOpen, paletteOpen]);

  useEffect(() => {
    setPathSearch(window.location.search);
  }, [pathname, locationTick]);

  useEffect(() => {
    setNavOpen(false);
    setPaletteOpen(false);
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
  }, [pathname]);

  useEffect(() => {
    setRecentOrgIds(listRecentOrgIds());
    const mac = /mac|iphone|ipad|ipod/i.test(window.navigator.platform || window.navigator.userAgent);
    setShortcutHint(mac ? "⌘K" : "Ctrl K");
  }, []);

  useEffect(() => {
    if (!navOpen) {
      const opener = navOpenerRef.current;
      const wasOpen = navWasOpenRef.current;
      navOpenerRef.current = null;
      navWasOpenRef.current = false;
      if (wasOpen) requestAnimationFrame(() => {
        // The menu closed to open the "Your apps" editor or the search palette: focus is theirs.
        if (document.activeElement?.closest(".pins-editor, .search-palette")) return;
        const visible = Boolean(opener?.isConnected && opener.getClientRects().length > 0 && getComputedStyle(opener).visibility !== "hidden");
        const fallback = [...document.querySelectorAll<HTMLElement>(".app-topbar-search, .soft-menu-btn")]
          .find(control => control.getClientRects().length > 0 && getComputedStyle(control).visibility !== "hidden");
        (visible ? opener : fallback)?.focus();
      });
      return;
    }
    navWasOpenRef.current = true;
    const wantsSearch = focusSearchOnOpen.current;
    focusSearchOnOpen.current = false;
    const focusTimer = window.setTimeout(() => {
      // A person may already have moved to a destination while the drawer
      // animates. Delayed initial focus must not steal their next keystroke.
      if (document.activeElement?.closest(".soft-drawer")) return;
      if (wantsSearch) searchInputRef.current?.focus();
      else panelCloseRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(focusTimer);
  }, [navOpen]);

  useEffect(() => {
    let cancelled = false;
    if (entryScreen) {
      void probeSessionUser()
        .then((user) => {
          if (cancelled || !user) return;
          setMe({ userId: user.id, name: user.name, email: user.email, image: user.image });
        })
        .finally(() => {
          if (!cancelled) setTeamsLoaded(true);
        });
      return () => {
        cancelled = true;
      };
    }
    const revision = notificationRevision.current;
    const globalInbox = pathname === "/notifications" && !new URLSearchParams(window.location.search).has("orgId");
    void fetchProductSession(globalInbox ? null : orgId || null)
      .then((data) => {
        if (cancelled || !data) return;
        setMe(data as Me);
        const rows = (Array.isArray(data.memberships) ? data.memberships : []).filter(
          (row): row is MembershipOption => Boolean(row?.orgId),
        );
        setMemberships(rows);
        const count = Number(data.unreadNotificationCount ?? 0);
        if (notificationRevision.current === revision) setUnreadCount(Number.isFinite(count) && count > 0 ? Math.floor(count) : 0);
        const messages = Number(data.unreadMessageCount ?? 0);
        setUnreadMessages(Number.isFinite(messages) && messages > 0 ? Math.floor(messages) : 0);
        if (!orgId && data.orgId) setOrgId(data.orgId);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setTeamsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // `online`: an answer that never came while offline is asked for again on reconnecting.
  }, [orgId, pathname, entryScreen, online]);

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<NotificationCountUpdate>).detail;
      const globalInbox = pathname === "/notifications" && !new URLSearchParams(window.location.search).has("orgId");
      if (!detail || (detail.orgId ?? "") !== (globalInbox ? "" : orgId) || !Number.isFinite(detail.unreadCount)) return;
      notificationRevision.current += 1;
      setUnreadCount(Math.max(0, detail.unreadCount));
    };
    window.addEventListener(NOTIFICATIONS_CHANGED, update);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, update);
  }, [orgId, pathname]);

  // The inbox publishes read changes (this tab and others) on its own channel; the bell follows
  // them for this person and the team in view.
  useEffect(() => listenInboxUpdates((data) => {
    if (!me.userId || data.userId !== me.userId) return;
    if ((data.orgId ?? "") !== (orgId ?? "")) return;
    notificationRevision.current += 1;
    setUnreadCount(Math.max(0, data.unreadCount));
  }), [me.userId, orgId]);

  useEffect(() => {
    if (entryScreen) return;
    const controller = new AbortController();
    const revision = pinsRevision.current;
    void fetch("/api/navigation/preferences", {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
    })
      .then(async (response) => (response.ok ? response.json() as Promise<{ tabs?: unknown }> : null))
      .then((data) => {
        if (!data || controller.signal.aborted || revision !== pinsRevision.current) return;
        setPinHrefs(resolveStoredPins(data.tabs));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [entryScreen]);

  const openIslandEditor = useCallback(() => {
    setNavOpen(false);
    setPaletteOpen(false);
    setAccountMenuOpen(false);
    setIslandEditorOpen(true);
  }, []);

  // ?island=1 (older links and the help article) and Account → Appearance open the same editor.
  useEffect(() => {
    if (islandQueryOpened.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("island") === "1" || params.get("customize") === "island") {
      islandQueryOpened.current = true;
      openIslandEditor();
    }
  }, [pathname, openIslandEditor]);
  useEffect(() => {
    window.addEventListener(PINS_EDIT_EVENT, openIslandEditor);
    return () => window.removeEventListener(PINS_EDIT_EVENT, openIslandEditor);
  }, [openIslandEditor]);

  /** Saves the editor's draft. Resolves to a message to show, or null when saved. */
  const savePins = useCallback(async (draft: string[]): Promise<string | null> => {
    const id = ++pinsRevision.current;
    try {
      const response = await fetch("/api/navigation/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tabs: draft }),
        signal: AbortSignal.timeout(8_000),
      });
      const data = (await response.json().catch(() => ({}))) as { tabs?: unknown; error?: string };
      if (!response.ok) return data.error ?? "Your apps couldn't be saved. Try again.";
      if (id === pinsRevision.current) setPinHrefs(resolveStoredPins(data.tabs));
      window.dispatchEvent(new CustomEvent(PINS_CHANGED_EVENT, { detail: { tabs: data.tabs } }));
      setIslandEditorOpen(false);
      return null;
    } catch {
      return "Your apps couldn't be saved. Check your connection and try again.";
    }
  }, []);

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
      // Onboarding has no menu or search to open (the topbar there is the logo and Sign out).
      // ⌘K again closes it, as in Spotlight. Phones with a keyboard get the palette too.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k" && window.location.pathname !== "/onboarding") {
        event.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
      }
      if (event.key === "Escape") {
        setNavOpen(false);
        setPaletteOpen(false);
        setAccountMenuOpen(false);
        setIslandEditorOpen(false);
          }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePalette, openPalette, paletteOpen]);

  const accountLabel = accountLabelFor(me);
  const initial = accountInitialFor(me);
  const hubAccess = me.hubAccess ?? null;
  const sponsorsAllowed = me.sponsorsAllowed;
  const navHrefAllowed = useCallback(
    (href: string) =>
      pathAllowedByHubAccess(href, hubAccess) && pathAllowedBySponsors(href, sponsorsAllowed),
    [hubAccess, sponsorsAllowed],
  );
  const visiblePinCatalog = useMemo(() => pinCatalog(navHrefAllowed), [navHrefAllowed]);
  const visibleNavGroups = useMemo(
    () => filterVisibleNavGroups(groups, navHrefAllowed),
    [navHrefAllowed],
  );

  const paletteCatalog = useMemo(() => commandCatalogFor({ platformAdmin: me.platformAdmin }), [me.platformAdmin]);

  const canManageTeam = useMemo(() => {
    const membershipRole = orgId ? memberships.find((row) => row.orgId === orgId)?.role : undefined;
    return settingsRoleTier(membershipRole ?? me.role) === "owner-admin";
  }, [memberships, me.role, orgId]);
  // The menu's field and the palette each keep their own query; both forget it on closing.
  const menuSearch = useShellSearch({
    active: navOpen,
    orgId,
    catalog: paletteCatalog,
    isAllowed: navHrefAllowed,
    canManageTeam,
    navigate,
    onDone: closeNav,
  });
  const paletteSearch = useShellSearch({
    active: paletteOpen,
    orgId,
    catalog: paletteCatalog,
    isAllowed: navHrefAllowed,
    canManageTeam,
    navigate,
    onDone: closePalette,
    suggestWhenEmpty: true,
  });

  const orderedMemberships = useMemo(
    () => sortMembershipsByRecent(memberships, recentOrgIds),
    [memberships, recentOrgIds],
  );

  // Onboarding is a short, focused flow: its tabs and shortcuts only bounced back to it.
  const onboarding = pathname === "/onboarding";
  // The invite landing and the 404 keep the product's styles but not its chrome: the person
  // there usually has no account yet, or took a wrong turn, and a team switcher reading
  // "No team selected" plus a tab bar of sign-in walls only looked broken.
  const bare = pathnameIsBareShell(pathname);
  const isHubRoot = isHubRootPath(pathname);
  const showBack = showBackForPath(pathname);
  const backHref = useMemo(() => backHrefForPath(pathname, orgId || null), [pathname, orgId]);
  const title = shellTitleForPath(pathname, pathSearch);
  // One placeholder, then the real team: never "Your team" → "This team" → "Team 6925".
  const orgLabel = shellOrgLabel({ pathname, orgId, me, teamsLoaded, remembered: rememberedTeamLabel });
  const rolePlanCue = formatRolePlanCue(me.role, me.planCode, me.paidOrg);
  // Every settings page is "Settings › Section", whichever page it is underneath.
  const crumbHint = isSettingsPath(pathname) ? "Settings" : breadcrumbForPath(pathname);
  // Not on Home: Home leads with its own next-match card, and the strip made it three times.
  // Not while scouting either: the match card there already says which match, and on a phone
  // the strip took ~105px from the counters.
  // Nor on the Competition pages themselves (Event day, Scouting, Strategy, Robot check): they
  // are about the next match already, and on a phone the strip stacked a third bar on top.
  const scouting = pathname === "/scouting" || pathname === "/competition";
  const eventFocus = useMemo(
    () =>
      pathname === "/dashboard" || pathname.startsWith("/admin") || scouting
        ? null
        : buildEventFocus(myDayGlance, online),
    [myDayGlance, online, pathname, scouting],
  );
  // Pins this team may open; the bottom bar takes the first four of them.
  const pins = useMemo(() => resolvePins(pinHrefs).filter((pin) => navHrefAllowed(pin.href)), [pinHrefs, navHrefAllowed]);
  const islandTabs = useMemo(() => pins.slice(0, BAR_SLOTS), [pins]);
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
    setPaletteOpen(false);
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
  }, []);

  const switchWorkspaceHref = useCallback(
    (nextOrgId: string) => switchWorkspaceHrefFor(pathname, pathSearch, nextOrgId),
    [pathname, pathSearch],
  );

  const onWorkspaceSwitch = useCallback((nextOrgId: string) => {
    setRecentOrgIds(rememberRecentOrg(nextOrgId));
  }, []);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    closeOverlays();
    await signOutAndRedirect("/");
    setSigningOut(false);
  }

  if (bare) return null;

  return (
    <>
      <a className="soft-skip-link" href="#main-content">
        Skip to main content
      </a>
      <NextActionsDedupe routeKey={`${pathname}:${locationTick}`} />
      {!onboarding ? <AppShellSidebar groups={visibleNavGroups} pins={pins} pathname={pathname} pathSearch={pathSearch}
        orgId={orgId} orgLabel={orgLabel} roleCue={rolePlanCue} collapsed={sidebarCollapsed} onCollapse={toggleSidebar}
        onEditPins={openIslandEditor} allowed={navHrefAllowed} /> : null}
      <AppShellTopbar
        showBack={showBack}
        onBack={() => navigate(backHref)}
        isHubRoot={isHubRoot}
        title={title}
        orgLabel={orgLabel}
        crumbHint={crumbHint}
        orgId={orgId}
        navOpen={navOpen}
        menuOpen={navOpen}
        onOpenNav={toggleMenu}
        searchOpen={paletteOpen}
        onOpenSearch={openPalette}
        shortcutHint={shortcutHint}
        onOpenTeams={() => navigate(workspacePickerHref(pathname, pathSearch))}
        minimal={onboarding}
        unreadCount={unreadCount}
        accountMenuOpen={accountMenuOpen}
        onToggleAccount={() => setAccountMenuOpen((value) => !value)}
        onCloseAccount={() => setAccountMenuOpen(false)}
        me={me}
        initial={initial}
        accountLabel={accountLabel}
        rolePlanCue={rolePlanCue}
        memberships={memberships}
        orderedMemberships={orderedMemberships}
        recentOrgIds={recentOrgIds}
        signingOut={signingOut}
        switchWorkspaceHref={switchWorkspaceHref}
        onWorkspaceSwitch={onWorkspaceSwitch}
        onSignOut={() => void handleSignOut()}
      />
      {eventFocus ? (
        <AppShellEventFocus
          eventFocus={eventFocus}
          focusCollapsed={focusCollapsed}
          onCollapse={() => setFocusCollapsed(true)}
          onExpand={() => setFocusCollapsed(false)}
        />
      ) : null}
      {entryScreen ? null : <LegalUpdateBanner />}
      {/* On entry screens too: /access-unavailable is where people land while the database is down. */}
      <ServiceNoticeBanner
        cacheOrgId={!entryScreen && me.userId && orgId ? orgId : null}
        orgLabel={me.teamNumber ? `Team ${me.teamNumber}` : (me.orgName ?? null)}
      />
      {accountMenuOpen ? (
        <button
          className="soft-account-scrim"
          type="button"
          aria-label="Close account menu"
          onClick={() => setAccountMenuOpen(false)}
        />
      ) : null}
      <AppShellNavPanel
        navOpen={navOpen}
        closeNav={closeNav}
        panelCloseRef={panelCloseRef}
        searchInputRef={searchInputRef}
        orgLabel={orgLabel}
        rolePlanCue={rolePlanCue}
        orgId={orgId}
        search={menuSearch}
        shortcutHint={shortcutHint}
        visibleNavGroups={visibleNavGroups}
        pins={pins}
        activeGroupLabel={activeGroupLabel}
        pathname={pathname}
        pathSearch={pathSearch}
        navHrefAllowed={navHrefAllowed}
        onEditPins={openIslandEditor}
      />
      <AppShellSearchPalette
        open={paletteOpen}
        onClose={closePalette}
        search={paletteSearch}
        orgId={orgId}
        shortcutHint={shortcutHint}
      />
      <AppTour />
      <FeedbackButton orgId={orgId} signedIn={Boolean(me.userId) && !entryScreen} />
      {entryScreen ? null : <StatusEcho />}
      {onboarding ? null : (
      <AppShellIsland
        orgId={orgId}
        islandTabs={islandTabs}
        activeIslandTabHref={activeIslandTabHref}
        unreadMessages={unreadMessages}
        onOpenEditor={openIslandEditor}
        onOpenMore={toggleMenu}
        navOpen={navOpen}
        islandPressTimer={islandPressTimer}
        islandPressOrigin={islandPressOrigin}
        islandLongPressed={islandLongPressed}
      />
      )}
      <AppShellPinsEditor
        open={islandEditorOpen}
        pins={pinHrefs}
        catalog={visiblePinCatalog}
        allowed={navHrefAllowed}
        onCancel={() => setIslandEditorOpen(false)}
        onSave={savePins}
      />
    </>
  );
}

export { Icon };
export type { IconName };
