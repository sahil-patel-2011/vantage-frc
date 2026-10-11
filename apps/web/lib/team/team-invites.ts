import { formatInviteRole } from "../invite/invite-flow";

export type InviteDeliveryMode = "resend" | "local" | "unconfigured" | "failed";

/** One row of POST /api/organizations/invites { emails: [...] }. */
export type BulkInviteResult = {
  email: string;
  ok: boolean;
  id?: string;
  inviteUrl?: string;
  delivery?: InviteDeliveryMode;
  emailSent?: boolean;
  error?: string;
  status?: number;
  code?: string;
};

/**
 * What Team admin says after a pasted list, and what stays in the Email field: every address
 * that was not invited, so the owner fixes or resends them instead of retyping (QA A3-11).
 * An address that is already on the team is reported but not kept (sending again won't help).
 */
export function bulkInviteOutcome(results: BulkInviteResult[]): {
  tone: "ok" | "warn";
  message: string;
  made: Array<{ email: string; id: string; url: string }>;
  keep: string[];
} {
  const made = results
    .filter((row) => row.ok && row.id && row.inviteUrl)
    .map((row) => ({ email: row.email, id: row.id!, url: row.inviteUrl! }));
  const failed = results.filter((row) => !(row.ok && row.id && row.inviteUrl));
  const keep = failed.filter((row) => row.code !== "already_member").map((row) => row.email);
  const delivery = results.find((row) => row.ok)?.delivery;
  const sent = Boolean(delivery) && !inviteEmailIsOff(delivery) && delivery !== "failed";
  const parts = [`${made.length} ${made.length === 1 ? "invite" : "invites"} ready.`];
  if (made.length) {
    parts.push(sent ? "We emailed each of them a link." : "Email is off here, so copy the links below and send them yourself.");
  }
  if (failed.length) {
    parts.push(`Not invited yet: ${failed.map((row) => `${row.email} (${row.error ?? "could not be invited"})`).join("; ")}.`);
    if (keep.length) parts.push(`${keep.length === 1 ? "That address is" : "Those addresses are"} still in the Email box to fix or send again.`);
  }
  return { tone: failed.length ? "warn" : "ok", message: parts.join(" "), made, keep };
}

/**
 * When a waiting invite stops working, in words. It said "expires tomorrow" for an invite with
 * two hours left (whole days rounded up); under a day it now counts hours or minutes, and past
 * a day it names the date.
 */
export function inviteExpiryWords(expiresAt: string, now = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "expired";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `expires in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  // The date, the way the owner invite from platform admin reads ("expires Oct 1").
  return `expires ${new Date(expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** No real email leaves this server (none set up, or a local one that only logs). */
export function inviteEmailIsOff(mode: InviteDeliveryMode | null | undefined): boolean {
  return mode === "local" || mode === "unconfigured";
}

export type InviteRowStatus = "pending" | "accepted" | "expired" | "revoked" | "unknown";

export function normalizeInviteRowStatus(status: string | null | undefined): InviteRowStatus {
  const value = status?.trim().toLowerCase() ?? "";
  if (value === "pending" || value === "accepted" || value === "expired" || value === "revoked") {
    return value;
  }
  return "unknown";
}

export function formatInviteRowStatus(status: string | null | undefined): string {
  const normalized = normalizeInviteRowStatus(status);
  if (normalized === "pending") return "Pending";
  if (normalized === "accepted") return "Accepted";
  if (normalized === "expired") return "Expired";
  if (normalized === "revoked") return "Revoked";
  return status?.trim() || "Unknown";
}

export function formatInviteRowMeta(input: {
  role: string;
  status: string;
}): string {
  const role = formatInviteRole(input.role) ?? input.role;
  return `${role} · ${formatInviteRowStatus(input.status)}`;
}

/**
 * Copy shown after create/resend — never claim email went out when it did not.
 * The invite itself worked in every case but a real send failure, so those
 * read as success ("ok"); only a failed send is a warning.
 */
export function inviteSendResultCopy(input: {
  emailSent: boolean;
  delivery: InviteDeliveryMode;
  emailError?: string | null;
}): { tone: "ok" | "warn" | "error"; message: string } {
  if (input.delivery === "local" || input.delivery === "unconfigured") {
    return {
      tone: "ok",
      message: "Email is off on this server, so copy the link and send it to them yourself.",
    };
  }
  if (input.delivery === "failed" && !input.emailSent) {
    return {
      tone: "warn",
      message:
        input.emailError?.trim() ||
        "The email didn't send. Copy the link and send it to them yourself.",
    };
  }
  if (input.emailSent) {
    return {
      tone: "ok",
      message: "We emailed them a link. You can also copy it and send it yourself.",
    };
  }
  return {
    tone: "warn",
    message: "Copy the link and send it to them yourself.",
  };
}

export function inviteDeliveryBanner(mode: InviteDeliveryMode | null | undefined): {
  tone: "setup" | "info";
  title: string;
  detail: string;
} | null {
  if (mode === "unconfigured" || mode === "local") {
    return {
      tone: "info",
      title: "Email is off here",
      detail: "Create the invite, then copy its link and send it to them yourself.",
    };
  }
  return null;
}

/**
 * The link button on a waiting invite: its visible words, and an accessible name that starts with
 * them (WCAG 2.5.3, label in name). It read "Get a new link" on screen while a screen reader or
 * voice control heard "Make a new invite link for …", so saying what was on the button did nothing.
 */
export function inviteLinkButtonLabels(input: {
  email: string;
  hasLink: boolean;
  copied: boolean;
  confirmingNewLink: boolean;
}): { label: string; accessibleName: string } {
  const label = input.copied
    ? "Copied"
    : input.hasLink
      ? "Copy link"
      : input.confirmingNewLink
        ? "Tap again: the old link stops working"
        : "Get a new link";
  return { label, accessibleName: `${label} for ${input.email}` };
}
