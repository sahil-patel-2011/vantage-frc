"use client";

import { anySignal } from "../lib/abort/any-signal";
import "../app/product-styles";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShellIsland } from "./app-shell-island";
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
import { breadcrumbForPath } from "../lib/nav/product-nav";
import { PINS_CHANGED_EVENT, PINS_EDIT_EVENT, defaultPinHrefs, pinCatalog, resolvePins, resolveStoredPins } from "../lib/nav/pins";
import { publishPinnedHrefs } from "../lib/nav/pin-snapshot";
import {
  pathAllowedByHubAccess,
  pathAllowedBySponsors,
} from "../lib/nav/hub-access-filter";
import { commandCatalogFor } from "../lib/nav/command-search";
import { isSettingsPath, settingsRoleTier } from "../lib/nav/settings-nav";
import { pushAppNavigation, softNavigationTarget } from "../lib/nav/soft-navigation";
import { fetchProductSession } from "../lib/nav/product-session";
import { pathnameIsEntryScreen } from "../lib/nav/product-route";
import { probeSessionUser } from "../lib/nav/session-probe";
import { placeForPath, visiblePlaces } from "../lib/nav/places";
import { Icon, type IconName } from "./icon";
import { signOutAndRedirect } from "../lib/sign-out";
import { NOTIFICATIONS_CHANGED, type NotificationCountUpdate } from "../lib/notifications/events";
import { listenInboxUpdates } from "../lib/notifications/inbox-events";
import { onTeamDataChanged } from "../lib/team-data-changed";
import { watchSessionBoundary } from "../lib/offline/identity";
import { warmEventDayInBackground } from "../lib/offline/event-day-pack";
import { pathnameIsBareShell } from "../lib/nav/shell-body-class";
import { URL_CHANGE_EVENT } from "../lib/nav/url-change";
import { NextActionsDedupe } from "./next-actions-dedupe";
import {
  accountInitialFor,
  accountLabelFor,
  backHrefForPath,
  formatRolePlanCue,
  isHubRootPath,
  readRememberedTeamLabel,
  rememberTeamLabel,
  shellOrgLabel,
  teamLabelFor,
  shellTitleForPath,
  showBackForPath,
  type Me,
  type MembershipOption,
} from "./app-shell-model";
import { readRememberedInitial, readRememberedRoleCue, rememberInitial, rememberRoleCue } from "../lib/nav/shell-memory";

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
  /**
   * null until the address is read. /api/me is fetched for this scope, not on every pathname:
   * the shell used to ask again on each navigation even when the team had not changed.
   * "global" is the notification inbox with no team selected.
   */
  const [sessionScope, setSessionScope] = useState<string | null>(null);
  // The team's spreadsheets follow the app on their own: no Sync button to remember.
  useSheetsAutoSync(orgId);
  /**
   * Going places is the five places (the sidebar on a computer, the bottom bar on a phone).
   * Finding anything else is the search palette: ⌘K / Ctrl+K or the top bar's "Search or ask",
   * one field, centered, on every screen size. There is no menu drawer behind either.
   */
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
  const [rememberedRoleCue, setRememberedRoleCue] = useState<string | null>(null);
  const [rememberedInitial, setRememberedInitial] = useState<string | null>(null);
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
  const [online, setOnline] = useState(true);
  /** Pins: the sidebar on a computer, empty search on a phone. */
  const [pinHrefs, setPinHrefs] = useState<string[]>(defaultPinHrefs);
  useEffect(() => {
    publishPinnedHrefs(pinHrefs);
  }, [pinHrefs]);
  const [islandEditorOpen, setIslandEditorOpen] = useState(false);
  const [memberships, setMemberships] = useState<MembershipOption[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [pathSearch, setPathSearch] = useState("");
  const [shortcutHint, setShortcutHint] = useState("");
  const islandQueryOpened = useRef(false);
  // A save that lands wins over a late-arriving read of the old pins.
  const pinsRevision = useRef(0);
  /** Bumps when the URL changes without a pathname change (?orgId=, ?tab=), so query-driven state follows soft navigations. */
  const [locationTick, setLocationTick] = useState(0);

  // Another person signing in on this device (another tab) ends this tab's session view.
  useEffect(() => { watchSessionBoundary(); }, []);
  // Keep Event Day, My Day and the schedule saved on this device (lib/offline/event-day-pack):
  // at most every 30 minutes per team, when the browser is idle, so the first open in a crowded
  // venue reads the local copy instead of waiting on the network.
  useEffect(() => {
    if (!orgId || !me.userId) return;
    const run = () => void warmEventDayInBackground(orgId, { userId: me.userId }).catch(() => undefined);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 15_000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(run, 8_000);
    return () => window.clearTimeout(id);
  }, [orgId, me.userId]);

  /** ⌘K / Ctrl+K and "Search anything": the search palette, never the menu. */
  const openPalette = useCallback(() => {
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

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
    // Warm only a destination the person shows intent to open. Never prefetch every tool.
    const warmed = new Set<string>();
    let warmTimer: number | undefined;
    const onIntent = (event: Event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor || !routerReady) return;
      const path = softNavigationTarget({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false }, {
        href: anchor.getAttribute("href") ?? "", target: anchor.getAttribute("target") ?? "", hasDownload: anchor.hasAttribute("download"),
        rel: anchor.getAttribute("rel") ?? "", fullReload: Boolean(anchor.closest("[data-full-reload]")),
      }, new URL(window.location.href));
      if (!path || path.startsWith("/workspace") || warmed.has(path) || warmed.size >= 12) return;
      window.clearTimeout(warmTimer);
      warmTimer = window.setTimeout(() => { warmed.add(path); router.prefetch(path); }, 100);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("pointerover", onIntent);
    document.addEventListener("focusin", onIntent);
    window.addEventListener("popstate", onPop);
    // A hub switching tabs in place rewrites the address without navigating.
    window.addEventListener(URL_CHANGE_EVENT, onPop);
    // Hover and focus warm a page. Idle time does not: prefetching ten routes
    // after one visit ran each of their server renders and multiplied database
    // load for a person who never opened them.
    const readyTimer = window.setTimeout(() => {
      routerReady = true;
    }, 300);
    return () => {
      window.clearTimeout(readyTimer);
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointerover", onIntent);
      document.removeEventListener("focusin", onIntent);
      window.clearTimeout(warmTimer);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener(URL_CHANGE_EVENT, onPop);
    };
  }, [navigate, router, orgId, me.userId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("orgId") ?? "";
    setOrgId(id);
    const globalInbox = pathname === "/notifications" && !params.has("orgId");
    setSessionScope(globalInbox ? "global" : id || "member");
    // Same render as the team id, so the label goes straight from the placeholder to the name
    // this device last showed for the team.
    setRememberedTeamLabel(readRememberedTeamLabel(safeLocalStorage(), id));
    setRememberedRoleCue(readRememberedRoleCue(safeLocalStorage(), id));
    setRememberedInitial(readRememberedInitial(safeLocalStorage()));
    // has-app-shell, shell-bare and shell-onboarding are on <body> in the server HTML
    // (components/app-body.tsx), so the first paint is already this frame.
  }, [pathname, locationTick]);

  useEffect(() => {
    document.body.classList.toggle(
      "soft-nav-open",
      accountMenuOpen || islandEditorOpen || paletteOpen,
    );
    return () => {
      document.body.classList.remove("soft-nav-open");
    };
  }, [accountMenuOpen, islandEditorOpen, paletteOpen]);

  useEffect(() => {
    setPathSearch(window.location.search);
  }, [pathname, locationTick]);

  useEffect(() => {
    setPaletteOpen(false);
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
  }, [pathname]);

  useEffect(() => {
    const mac = /mac|iphone|ipad|ipod/i.test(window.navigator.platform || window.navigator.userAgent);
    setShortcutHint(mac ? "⌘K" : "Ctrl K");
  }, []);

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
    if (sessionScope === null) return;
    const revision = notificationRevision.current;
    const globalInbox = sessionScope === "global";
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
    // Pathname is intentionally not a dependency: the same team does not reload /api/me on every page.
  }, [orgId, sessionScope, entryScreen, online]);

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
    if (!orgId || !me.userId) return;
    let stopped = false;
    let controller: AbortController | null = null;
    const stop = onTeamDataChanged(orgId, () => {
      controller?.abort(); controller = new AbortController();
      const signal = anySignal([controller.signal, AbortSignal.timeout(5_000)]);
      const revision = ++notificationRevision.current;
      void fetch(`/api/notifications?mode=count&orgId=${encodeURIComponent(orgId)}`, { cache: "no-store", signal })
        .then(async response => response.ok ? response.json() : null)
        .then(data => {
          if (!stopped && !signal.aborted && revision === notificationRevision.current && data?.userId === me.userId && data.orgId === orgId) setUnreadCount(Math.max(0, Number(data.unreadCount) || 0));
        }).catch(() => undefined);
    });
    return () => { stopped = true; controller?.abort(); stop(); };
  }, [orgId, me.userId]);

  useEffect(() => {
    if (entryScreen) return;
    const controller = new AbortController();
    const revision = pinsRevision.current;
    void fetch("/api/navigation/preferences", {
      cache: "no-store",
      signal: anySignal([controller.signal, AbortSignal.timeout(8_000)]),
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
      if (!response.ok) return data.error ?? "Your pins couldn't be saved. Try again.";
      if (id === pinsRevision.current) setPinHrefs(resolveStoredPins(data.tabs));
      window.dispatchEvent(new CustomEvent(PINS_CHANGED_EVENT, { detail: { tabs: data.tabs } }));
      setIslandEditorOpen(false);
      return null;
    } catch {
      return "Your pins couldn't be saved. Check your connection and try again.";
    }
  }, []);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      // Live connection state for CSS: "showing the last copy" notes (lib/ui/stale-copy) hide
      // while offline, under the offline banner, and come back on reconnect.
      document.documentElement.dataset.network = navigator.onLine ? "online" : "offline";
    };
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
        setPaletteOpen(false);
        setAccountMenuOpen(false);
        setIslandEditorOpen(false);
          }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePalette, openPalette, paletteOpen]);

  const accountLabel = accountLabelFor(me);
  // Until /api/me answers, the letter this device last showed rather than a generic person.
  const loadedInitial = accountInitialFor(me);
  const initial = me.userId ? loadedInitial : rememberedInitial ?? loadedInitial;
  useEffect(() => {
    if (me.userId) rememberInitial(safeLocalStorage(), loadedInitial);
  }, [me.userId, loadedInitial]);
  const hubAccess = me.hubAccess ?? null;
  const sponsorsAllowed = me.sponsorsAllowed;
  const navHrefAllowed = useCallback(
    (href: string) =>
      pathAllowedByHubAccess(href, hubAccess) && pathAllowedBySponsors(href, sponsorsAllowed),
    [hubAccess, sponsorsAllowed],
  );
  const visiblePinCatalog = useMemo(() => pinCatalog(navHrefAllowed), [navHrefAllowed]);

  const paletteCatalog = useMemo(() => commandCatalogFor({ platformAdmin: me.platformAdmin }), [me.platformAdmin]);

  const canManageTeam = useMemo(() => {
    const membershipRole = orgId ? memberships.find((row) => row.orgId === orgId)?.role : undefined;
    return settingsRoleTier(membershipRole ?? me.role) === "owner-admin";
  }, [memberships, me.role, orgId]);
  // One search for the whole app: the palette (Search in the top bar, the menu, or ⌘K / Ctrl+K).
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

  // Onboarding is a short, focused flow: its tabs and shortcuts only bounced back to it.
  const onboarding = pathname === "/onboarding";
  // The invite landing and the 404 keep the product's styles but not its chrome: the person
  // there usually has no account yet, or took a wrong turn, and a team switcher reading
  // "No team selected" plus a tab bar of sign-in walls only looked broken.
  const bare = pathnameIsBareShell(pathname);
  const isHubRoot = isHubRootPath(pathname);
  // Settings has its own All settings link; the topbar need not repeat its title and back.
  const showBack = showBackForPath(pathname) && !isSettingsPath(pathname);
  const backHref = useMemo(() => backHrefForPath(pathname, orgId || null), [pathname, orgId]);
  const title = shellTitleForPath(pathname, pathSearch);
  // One placeholder, then the real team: never "Your team" → "This team" → "Team 6925".
  const orgLabel = shellOrgLabel({ pathname, orgId, me, teamsLoaded, remembered: rememberedTeamLabel });
  // The same for the role under the team: "Owner" stays "Owner" instead of flashing "Your team".
  const loadedRoleCue = formatRolePlanCue(me.role, me.planCode, me.paidOrg);
  const rolePlanCue = me.role ? loadedRoleCue : rememberedRoleCue ?? loadedRoleCue;
  useEffect(() => {
    if (me.role && me.orgId) rememberRoleCue(safeLocalStorage(), me.orgId, loadedRoleCue);
  }, [me.role, me.orgId, loadedRoleCue]);
  // Every settings page is "Settings › Section", whichever page it is underneath.
  const crumbHint = isSettingsPath(pathname) ? "Settings" : breadcrumbForPath(pathname);
  // Match context lives on Home and My Day, without another global navigation band.
  // Pins this team may open.
  const pins = useMemo(() => resolvePins(pinHrefs).filter((pin) => navHrefAllowed(pin.href)), [pinHrefs, navHrefAllowed]);
  // The five places this person may open, and the one this page belongs to.
  const places = useMemo(() => visiblePlaces(navHrefAllowed), [navHrefAllowed]);
  const currentPlace = useMemo(() => placeForPath(pathname), [pathname]);
  // A pin to a place itself (Home) is already one tap away in the sidebar and the bottom bar.
  const pinShortcuts = useMemo(() => pins.filter((pin) => !places.some((place) => place.href === pin.href)), [pins, places]);

  const closeOverlays = useCallback(() => {
    setPaletteOpen(false);
    setAccountMenuOpen(false);
    setIslandEditorOpen(false);
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
      {!onboarding ? <AppShellSidebar places={places} currentPlace={currentPlace} pins={pinShortcuts} pathname={pathname} pathSearch={pathSearch}
        orgId={orgId} orgLabel={orgLabel} collapsed={sidebarCollapsed} onCollapse={toggleSidebar}
        onEditPins={openIslandEditor} allowed={navHrefAllowed} /> : null}
      <AppShellTopbar
        showBack={showBack}
        onBack={() => navigate(backHref)}
        isHubRoot={isHubRoot}
        title={title}
        orgLabel={orgLabel}
        crumbHint={crumbHint}
        orgId={orgId}
        searchOpen={paletteOpen}
        onOpenSearch={openPalette}
        shortcutHint={shortcutHint}
        minimal={onboarding}
        unreadCount={unreadCount}
        accountMenuOpen={accountMenuOpen}
        onToggleAccount={() => setAccountMenuOpen((value) => !value)}
        onCloseAccount={() => setAccountMenuOpen(false)}
        me={me}
        initial={initial}
        accountLabel={accountLabel}
        memberships={memberships}
        rolePlanCue={orgId ? rolePlanCue : null}
        signingOut={signingOut}
        onSignOut={() => void handleSignOut()}
      />
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
      <AppShellSearchPalette
        open={paletteOpen}
        onClose={closePalette}
        search={paletteSearch}
        orgId={orgId}
        shortcutHint={shortcutHint}
        pins={pinShortcuts}
        onEditPins={openIslandEditor}
      />
      <AppTour />
      <FeedbackButton orgId={orgId} signedIn={Boolean(me.userId) && !entryScreen} showTrigger={false} />
      {entryScreen ? null : <StatusEcho />}
      {onboarding ? null : (
      <AppShellIsland
        orgId={orgId}
        places={places}
        currentPlace={currentPlace}
        unreadMessages={unreadMessages}
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
