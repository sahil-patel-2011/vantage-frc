"use client";

import { hubById, hubLegacyHref, isHubTab } from "../../lib/nav/hubs";

const BUSINESS_HUB = hubById("business");

export type Tab =
  | "overview"
  | "finance"
  | "budget"
  | "orders"
  | "sponsors"
  | "sponsorship"
  | "placements"
  | "grants"
  | "evidence";

export const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "finance", label: "Money" },
  { id: "budget", label: "Budget" },
  { id: "orders", label: "Orders" },
  { id: "sponsors", label: "Sponsors" },
  { id: "sponsorship", label: "Packages" },
  { id: "placements", label: "Partners" },
  { id: "grants", label: "Grants" },
  { id: "evidence", label: "Outreach" },
];

export function isTab(value: string | null): value is Tab {
  return TABS.some((tab) => tab.id === value);
}

export function readOrgIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("orgId");
}

export function readTabFromUrl(): Tab {
  if (typeof window === "undefined") return "overview";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return isTab(tab) ? tab : "overview";
}

/** Nested tools that are not in-panel jump to their standalone page. */
export function redirectMoreToolTab(): boolean {
  if (typeof window === "undefined") return false;
  const tab = new URLSearchParams(window.location.search).get("tab");
  if (!tab || isTab(tab) || !isHubTab(BUSINESS_HUB, tab)) return false;
  const nested = BUSINESS_HUB.tabs.find((entry) => entry.id === tab);
  if (!nested?.legacyHref) return false;
  window.location.replace(hubLegacyHref(nested, readOrgIdFromUrl()));
  return true;
}

export function writeTabToUrl(tab: Tab) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (tab === "overview") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

/** Recorded working funds — blank until a budget or cash line exists. */
export function recordedWorkingFundsCents(budget: {
  totalBudgetCents: number;
  sponsorIncomeCents: number;
  grantIncomeCents: number;
}): number {
  return budget.totalBudgetCents + budget.sponsorIncomeCents + budget.grantIncomeCents;
}

export function hasRecordedWorkingFunds(budget: {
  totalBudgetCents: number;
  sponsorIncomeCents: number;
  grantIncomeCents: number;
}): boolean {
  return recordedWorkingFundsCents(budget) > 0;
}

export function moneyWhenRecorded(cents: number): string {
  return cents > 0 ? money(cents) : "—";
}

export function statusLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
