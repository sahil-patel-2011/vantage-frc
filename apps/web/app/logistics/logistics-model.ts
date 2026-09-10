import type { LogisticsMember } from "../../lib/logistics";

export type ActionBody = Record<string, unknown> & { action: string; orgId: string };
export type RunFn = (body: ActionBody, key: string) => Promise<void>;

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function memberLabel(m: LogisticsMember): string {
  return m.name?.trim() || m.email?.trim() || m.userId.slice(0, 8);
}

export function canActOnline(online: boolean, fromCache: boolean): boolean {
  return online && !fromCache;
}
