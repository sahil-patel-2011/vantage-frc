"use client";

import { MEDIA_HUB_TABS, type MediaHubTab, type MediaPostDraftResult } from "../../lib/media";
import type { MediaView } from "../../lib/media/compute-media";
import { hubById, isHubTab } from "../../lib/nav/hubs";

export type Tab = MediaHubTab;
export type LiveView = Extract<MediaView, { status: "live" }>;
export type LiveWithDraft = LiveView & { draft?: MediaPostDraftResult };

const MEDIA_HUB = hubById("media");

export function isTab(value: string | null): value is Tab {
  return Boolean(value && MEDIA_HUB_TABS.includes(value as Tab) && isHubTab(MEDIA_HUB, value));
}

export function readTabFromUrl(): Tab {
  if (typeof window === "undefined") return "calendar";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return isTab(tab) ? tab : "calendar";
}

export function writeTabToUrl(tab: Tab) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (tab === "calendar") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

export function formatWhen(value: string | null): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fromLocalInputValue(value: string): string | null {
  if (!value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
