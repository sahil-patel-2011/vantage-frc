import { hubHref } from "../../lib/nav/hubs";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import { scoutDutyAction, type ScoutDuty } from "./dashboard-home-model";

/** Hide a generic shortcut when the next action already opens the same workspace. */
export function sameHomeDestination(left: string, right: string): boolean {
  const destination = (href: string) => {
    const url = new URL(href, "https://vantage.invalid");
    if (url.pathname === "/scouting") return "scouting";
    if (url.pathname === "/scout/teams") return "teams";
    if (url.pathname === "/todos") return "todos";
    if (url.pathname === "/competition") return url.searchParams.get("tab") ?? "scouting";
    if (url.pathname === "/team") return url.searchParams.get("tab") ?? "calendar";
    return url.pathname;
  };
  return destination(left) === destination(right);
}

export function scoutingHomeAction(input: { orgId: string; role: string | null; hasEvent: boolean; hasForms: boolean; duty?: ScoutDuty | null }) {
  const role = input.role?.toLowerCase();
  if (role === "viewer") return { label: "Explore teams", href: hubHref("/competition", "teams", input.orgId) };
  const duty = scoutDutyAction(input.duty);
  if (duty) return { label: duty.title, href: `${duty.href}&orgId=${encodeURIComponent(input.orgId)}` };
  if (input.hasEvent && !input.hasForms && (role === "owner" || role === "admin")) {
    return { label: "Set up scouting", href: hubHref("/competition", "forms", input.orgId) };
  }
  const practice = !input.hasEvent || !input.hasForms;
  return { label: practice ? "Practice scouting" : "Start scouting", href: `${hubHref("/competition", "scouting", input.orgId)}${practice ? "&mode=free" : ""}` };
}

export function liveCount(payload: WidgetPayload | undefined, key: string): number | null {
  const value = payload?.data?.[key];
  return payload?.status === "live" && typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export type HomeActivity = { title: string; startsAt: string; duty: boolean; ongoing: boolean };

/** Real calendar items and personal duties, ordered together; invalid timestamps stay unknown. */
export function homeActivities(calendar: WidgetPayload | undefined, myDay: WidgetPayload | undefined, now = new Date()): HomeActivity[] {
  const records = (payload: WidgetPayload | undefined, key: string, duty: boolean): HomeActivity[] => {
    const raw = payload?.status === "live" ? payload.data?.[key] : undefined;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.title !== "string" || typeof row.startsAt !== "string") return [];
      const at = Date.parse(row.startsAt);
      const end = typeof row.endsAt === "string" ? Date.parse(row.endsAt) : NaN;
      const ongoing = at <= now.getTime() && end > now.getTime();
      return Number.isFinite(at) && (at >= now.getTime() || ongoing) ? [{ title: row.title, startsAt: row.startsAt, duty, ongoing }] : [];
    });
  };
  return [...records(calendar, "items", false), ...records(myDay, "duties", true)]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, 3);
}

export type HomeTask = { id: string; title: string; status: "todo" | "doing"; dueOn: string | null; assigneeName: string | null; overdue: boolean };

/** Missing task data is unavailable, never a fabricated zero-task result. */
export function homeTasks(payload: WidgetPayload | undefined, now = new Date()): HomeTask[] {
  const raw = payload?.status === "live" ? payload.data?.items : undefined;
  if (!Array.isArray(raw)) return [];
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return raw.flatMap((value: unknown): HomeTask[] => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.title !== "string" || (row.status !== "todo" && row.status !== "doing")) return [];
    const dueOn = typeof row.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.dueOn) && Number.isFinite(Date.parse(row.dueOn)) ? row.dueOn : null;
    return [{ id: row.id, title: row.title, status: row.status, dueOn,
      assigneeName: typeof row.assigneeName === "string" ? row.assigneeName : null, overdue: dueOn !== null && dueOn < today }];
  }).slice(0, 5);
}
