"use client";

import type { ReactNode } from "react";
import { Modal } from "../../components/ui";

/** Shared pieces for the platform-admin console pages. */

export type AdminStatus = "healthy" | "degraded" | "down" | "not_set_up";

export const STATUS_WORD: Record<string, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
  not_set_up: "Not set up",
  active: "Active",
  used_up: "Used up",
  expired: "Ended",
  revoked: "Ended early",
  off: "Off",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className="ac-status" data-status={status}>
      {label ?? STATUS_WORD[status] ?? status}
    </span>
  );
}

export function usd(value: number, cents = true): string {
  if (!Number.isFinite(value)) return "$0";
  if (!cents && Number.isInteger(value)) return `$${value}`;
  return `$${value.toFixed(2)}`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** A credit meter that is a real progress bar for screen readers. */
export function CreditMeter({ used, total, label }: { used: number; total: number; label: string }) {
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="ac-meter" data-near={percent >= 80 && percent < 100 ? "" : undefined} data-full={percent >= 100 ? "" : undefined}>
      <div
        className="ac-meter-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${usd(used)} of ${usd(total)} used`}
      >
        <div className="ac-meter-fill" style={{ width: `${percent}%` }} />
      </div>
      <small>
        {usd(used)} of {usd(total)} used
      </small>
    </div>
  );
}

/** The panel that opens beside a list: a team, a module, a gift. */
export function SidePanel({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} className="ac-panel">
      {children}
    </Modal>
  );
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string };

/** fetch + JSON with the route's own sentence on failure, never a raw error. */
export async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
    if (!response.ok) {
      return { ok: false, status: response.status, error: body.error ?? "That didn't work. Try again.", code: body.code };
    }
    return { ok: true, data: body };
  } catch {
    return { ok: false, status: 0, error: "No connection. Check your internet and try again." };
  }
}

/** A refusal for an old sign-in comes with a way to fix it right there. */
export function ReauthHint({ code }: { code?: string }) {
  if (code !== "reauth_required") return null;
  return (
    <a className="ac-small" href="/signin?next=/admin">
      Sign in again
    </a>
  );
}

export function Chevron() {
  return (
    <svg className="ac-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
