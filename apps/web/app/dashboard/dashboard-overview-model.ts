import { hubHref } from "../../lib/nav/hubs";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import { scoutDutyAction, type ScoutDuty } from "./dashboard-home-model";

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

export type HomeActivity = { title: string; startsAt: string; duty: boolean };

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
      return Number.isFinite(at) && at >= now.getTime() ? [{ title: row.title, startsAt: row.startsAt, duty }] : [];
    });
  };
  return [...records(calendar, "items", false), ...records(myDay, "duties", true)]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, 3);
}
