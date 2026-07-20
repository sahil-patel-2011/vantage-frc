import { withOrgHref } from "../nav/product-nav";
import type { SupportTicket, SupportTicketStatus } from "./types";

/** Soft-UI related surfaces for team support tickets (never DEMO placeholders). */
export const SUPPORT_RELATED_LINKS = [
  { id: "account", label: "Account", path: "/account" },
  { id: "help", label: "App manual", path: "/docs" },
  { id: "workspace", label: "Workspace", path: "/workspace" },
  { id: "notifications", label: "Notifications", path: "/notifications" },
] as const;

export type SupportRelatedId = (typeof SUPPORT_RELATED_LINKS)[number]["id"];

export type SupportRelatedLink = {
  id: SupportRelatedId;
  label: string;
  href: string;
};

/**
 * Focused Soft-UI strip on `/support`.
 * Includes Help docs hub — tickets stay on this page.
 */
export const SUPPORT_RELATED_INCLUDE: SupportRelatedId[] = ["account", "help", "workspace", "notifications"];

/** Cross-links for Support Soft-UI — Account / Help / Workspace when included. Never DEMO tickets. */
export function supportRelatedLinks(
  orgId?: string | null,
  options?: { active?: SupportRelatedId; include?: SupportRelatedId[] },
): SupportRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SUPPORT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: withOrgHref(link.path, orgId),
  }));
}

export type SupportNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type SupportTicketSummary = {
  total: number;
  open: number;
  inProgress: number;
  awaitingReply: number;
  resolved: number;
  closed: number;
};

/** True when the member is still waiting on a platform reply (real ticket only). */
export function ticketAwaitsReply(ticket: SupportTicket): boolean {
  if (ticket.adminResponse?.trim()) return false;
  return ticket.status === "open" || ticket.status === "in_progress";
}

/**
 * Counts from submitted tickets only — empty list stays zero, never DEMO tickets.
 */
export function summarizeSupportTickets(tickets: SupportTicket[]): SupportTicketSummary {
  const summary: SupportTicketSummary = {
    total: tickets.length,
    open: 0,
    inProgress: 0,
    awaitingReply: 0,
    resolved: 0,
    closed: 0,
  };
  for (const ticket of tickets) {
    if (ticket.status === "open") summary.open += 1;
    else if (ticket.status === "in_progress") summary.inProgress += 1;
    else if (ticket.status === "resolved") summary.resolved += 1;
    else if (ticket.status === "closed") summary.closed += 1;
    if (ticketAwaitsReply(ticket)) summary.awaitingReply += 1;
  }
  return summary;
}

/** Soft-UI badge tone for ticket status — never a DEMO tone. */
export function supportStatusTone(status: SupportTicketStatus): "good" | "setup" | "" {
  if (status === "resolved") return "good";
  if (status === "open" || status === "in_progress") return "setup";
  return "";
}

/**
 * Soft-UI next actions for empty / setup Support.
 * Points at real workspace, new-ticket form, Account, and Notifications — never invents DEMO tickets.
 */
export function supportNextActions(input: {
  orgId?: string | null;
  ticketCount?: number;
  awaitingReply?: number;
}): SupportNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Support tickets are saved to your active team — choose a workspace first.",
        href: "/workspace",
        primary: true,
      },
      {
        id: "account",
        label: "Open Account",
        detail: "Profile and notification prefs live under Account — not DEMO support threads.",
        href: "/account",
      },
      {
        id: "help",
        label: "Open app manual",
        detail: "Soft-UI topics (island, Home, scouting, BYOK) — separate from tickets.",
        href: "/docs",
      },
    ];
  }

  const ticketCount = input.ticketCount ?? 0;
  const awaiting = input.awaitingReply ?? 0;
  const actions: SupportNextAction[] = [];

  if (ticketCount === 0) {
    actions.push({
      id: "submit",
      label: "Submit your first ticket",
      detail: "Describe what broke — the list stays empty until you send something. Never DEMO tickets.",
      href: "#support-new-ticket",
      primary: true,
    });
  } else if (awaiting > 0) {
    actions.push({
      id: "review",
      label: "Review tickets awaiting reply",
      detail: `${awaiting} open thread${awaiting === 1 ? "" : "s"} waiting on a platform response — only real submissions appear here.`,
      href: "#support-ticket-list",
      primary: true,
    });
  } else {
    actions.push({
      id: "submit-another",
      label: "Open a new ticket",
      detail: "Earlier tickets are resolved or closed. Submit again only when something new needs platform attention.",
      href: "#support-new-ticket",
      primary: true,
    });
  }

  actions.push(
    {
      id: "help",
      label: "App manual",
      detail: "Soft-UI topics — island, Edit Home, scouting, BYOK, Event Day, credits.",
      href: "/docs",
      primary: false,
    },
    {
      id: "account",
      label: "Account settings",
      detail: "Update your profile and sign-in details — separate from platform triage.",
      href: withOrgHref("/account", orgId),
      primary: false,
    },
    {
      id: "notifications",
      label: "Notification prefs",
      detail: "Inbox and email opt-ins for product notes — ticket replies still show on this page.",
      href: withOrgHref("/account", orgId) + "?tab=notifications",
    },
  );

  return actions.slice(0, 5);
}
