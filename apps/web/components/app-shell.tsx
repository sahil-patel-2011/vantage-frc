"use client";

import "../app/product-styles";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShellNavPanel } from "./app-shell-nav-panel";
import { AppShellEventFocus, AppShellIsland, AppShellIslandEditor } from "./app-shell-island";
import { AppShellTopbar } from "./app-shell-topbar";
import {
  ISLAND_TAB_CATALOG,
  PRODUCT_NAV_GROUPS,
  breadcrumbForPath,
  findNavMatch,
  withOrgHref,
} from "../lib/nav/product-nav";
import { defaultIslandHrefs, resolveIslandTabs, toggleIslandDraft } from "../lib/nav/island-preferences";
import {
  pathAllowedByHubAccess,
  pathAllowedBySponsors,
} from "../lib/nav/hub-access-filter";
import { listRecentOrgIds, rememberRecentOrg, sortMembershipsByRecent } from "../lib/nav/recent-teams";
import { commandCatalog, searchCommands } from "../lib/nav/command-search";
import { listRecentCommands, rememberRecentCommand } from "../lib/nav/recent-commands";
import { fetchProductSession } from "../lib/nav/product-session";
import { Icon, type IconName } from "./icon";
import { type MyDayView } from "../lib/my-day";
import { buildEventFocus } from "../lib/event-focus";
import { signOutAndRedirect } from "../lib/sign-out";
import {
  accountInitialFor,
  accountLabelFor,
  activeIslandHref,
  backHrefForPath,
  filterVisibleNavGroups,
  formatRolePlanCue,
  isHubRootPath,
  navResultRows,
  orgLabelFor,
  shellTitleForPath,
  showBackForPath,
  switchWorkspaceHrefFor,
  type Me,
  type MembershipOption,
  type SearchHit,
} from "./app-shell-model";

const groups = PRODUCT_NAV_GROUPS;

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
  const [shortcutHint, setShortcutHint] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelCloseRef = useRef<HTMLButtonElement>(null);
  const searchRequestId = useRef(0);
  const islandQueryOpened = useRef(false);
  const islandPressTimer = useRef<number | null>(null);
  const islandPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const islandLongPressed = useRef(false);
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
      .then(async (response) => (response.ok ? response.json() as Promise<{ tabs?: unknown }> : null))
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

  const accountLabel = accountLabelFor(me);
  const initial = accountInitialFor(me);
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
    () => filterVisibleNavGroups(groups, navHrefAllowed),
    [navHrefAllowed],
  );

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
            limit: 8,
            isAllowed: navHrefAllowed,
            recentHrefs: recentCommands,
          })
        : [],
    [navQuery, navHrefAllowed, paletteCatalog, queryActive, recentCommands],
  );

  const goToCommand = useCallback(
    (hit: { href: string }) => {
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

  const isHubRoot = isHubRootPath(pathname);
  const showBack = showBackForPath(pathname);
  const backHref = useMemo(() => backHrefForPath(pathname, orgId || null), [pathname, orgId]);
  const title = shellTitleForPath(pathname);
  const orgLabel = orgLabelFor(me, orgId);
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
    (nextOrgId: string) => switchWorkspaceHrefFor(pathname, pathSearch, nextOrgId),
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

  const resultRows = useMemo(
    () => navResultRows(commandHits, searchHits),
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

  function handleToggleIslandDraft(href: string) {
    setIslandDraft((current) => {
      const next = toggleIslandDraft(current, href);
      setIslandMessage(next.error ?? "");
      return next.draft;
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

  return (
    <>
      <a className="soft-skip-link" href="#main-content">
        Skip to main content
      </a>
      <AppShellTopbar
        showBack={showBack}
        onBack={() => router.push(backHref)}
        isHubRoot={isHubRoot}
        title={title}
        orgLabel={orgLabel}
        crumbHint={crumbHint}
        orgId={orgId}
        navOpen={navOpen}
        onOpenNav={() => openNav({ focusSearch: true })}
        shortcutHint={shortcutHint}
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
        me={me}
        initial={initial}
        accountLabel={accountLabel}
        orgLabel={orgLabel}
        rolePlanCue={rolePlanCue}
        orgId={orgId}
        workspaceOpen={workspaceOpen}
        setWorkspaceOpen={setWorkspaceOpen}
        memberships={memberships}
        orderedMemberships={orderedMemberships}
        switchWorkspaceHref={switchWorkspaceHref}
        onWorkspaceSwitch={onWorkspaceSwitch}
        navQuery={navQuery}
        setNavQuery={setNavQuery}
        resultRows={resultRows}
        commandHits={commandHits}
        searchHits={searchHits}
        searchLoading={searchLoading}
        queryActive={queryActive}
        activeRowIndex={activeRowIndex}
        setResultCursor={setResultCursor}
        goToCommand={goToCommand}
        openFullSearch={openFullSearch}
        jumpTopResult={jumpTopResult}
        shortcutHint={shortcutHint}
        visibleNavGroups={visibleNavGroups}
        activeGroupLabel={activeGroupLabel}
        pathname={pathname}
        pathSearch={pathSearch}
        navHrefAllowed={navHrefAllowed}
        openIslandEditor={openIslandEditor}
        signingOut={signingOut}
        onSignOut={() => void handleSignOut()}
      />
      <AppShellIsland
        orgId={orgId}
        islandTabs={islandTabs}
        activeIslandTabHref={activeIslandTabHref}
        unreadMessages={unreadMessages}
        navOpen={navOpen}
        onOpenNav={() => openNav()}
        onOpenEditor={openIslandEditor}
        islandPressTimer={islandPressTimer}
        islandPressOrigin={islandPressOrigin}
        islandLongPressed={islandLongPressed}
      />
      <AppShellIslandEditor
        open={islandEditorOpen}
        islandDraft={islandDraft}
        visibleIslandCatalog={visibleIslandCatalog}
        islandMessage={islandMessage}
        islandSaving={islandSaving}
        onClose={() => setIslandEditorOpen(false)}
        onToggle={handleToggleIslandDraft}
        onReset={() => setIslandDraft(defaultIslandHrefs())}
        onSave={() => void saveIsland()}
      />
    </>
  );
}

export { Icon };
export type { IconName };
