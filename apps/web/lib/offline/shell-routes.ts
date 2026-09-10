/**
 * Routes the service worker may network-first cache for cold offline loads.
 * Keep this list tight: only pages with IndexedDB (or equivalent) feature caches.
 */

export const OFFLINE_SHELL_ROUTES = [
  "/offline",
  "/offline-shell",
  "/scouting",
  "/schedule",
  "/competition",
  "/calendar",
  "/team/calendar",
  "/team",
  "/todos",
  "/tasks",
  "/logistics",
  "/build",
  "/files",
  "/docs",
  "/dashboard",
  "/strategy",
] as const;

export type OfflineShellRoute = (typeof OFFLINE_SHELL_ROUTES)[number];

/** Static assets always precached with the shell. */
export const OFFLINE_SHELL_ASSETS = ["/manifest.webmanifest", "/icon.svg", "/offline"] as const;

export function pathnameIsOfflineShell(pathname: string): boolean {
  const bare = pathname.split("?")[0]?.split("#")[0] ?? pathname;
  if (!bare.startsWith("/")) return false;
  return OFFLINE_SHELL_ROUTES.some(
    (route) => bare === route || bare.startsWith(`${route}/`),
  );
}

export function offlineCapableLabel(pathname: string): string | null {
  const bare = pathname.split("?")[0] ?? pathname;
  if (bare.startsWith("/scouting")) return "Scouting";
  if (bare.startsWith("/schedule")) return "Schedule";
  if (bare.startsWith("/offline-shell")) return "Offline Shell";
  if (bare === "/competition") return "Competition";
  if (
    bare.startsWith("/team/calendar") ||
    bare === "/calendar" ||
    bare.startsWith("/calendar/")
  ) {
    return "Calendar";
  }
  if (bare === "/team") return "Team";
  if (bare.startsWith("/todos") || bare.startsWith("/tasks")) return "Todos";
  if (bare.startsWith("/logistics")) return "Logistics";
  if (bare.startsWith("/build")) return "Build";
  if (bare.startsWith("/files")) return "Files";
  if (bare.startsWith("/docs") || bare.startsWith("/help")) return "Docs";
  if (bare.startsWith("/dashboard")) return "Home";
  if (bare.startsWith("/strategy")) return "Strategy";
  return null;
}

/** Next App Router RSC/Flight requests must never be intercepted or cached. */
export function isRscRequest(headers: { get(name: string): string | null }): boolean {
  const accept = headers.get("accept") ?? "";
  if (accept.includes("text/x-component")) return true;
  if (headers.get("rsc") === "1" || headers.get("RSC") === "1") return true;
  if (headers.get("next-router-state-tree") || headers.get("Next-Router-State-Tree")) return true;
  if (headers.get("next-router-prefetch") || headers.get("Next-Router-Prefetch")) return true;
  return false;
}

/** Failed navigations (including PWA start) always land on the precached shell. */
export function navigationFallbackPath(): string {
  return "/offline";
}
