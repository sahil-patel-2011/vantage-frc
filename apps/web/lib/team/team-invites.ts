import { formatInviteRole } from "../invite/invite-flow";

export type InviteDeliveryMode = "resend" | "local" | "unconfigured" | "failed";

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
      title: "Invites do not email from this server",
      detail: "After you send, copy the link and share it yourself.",
    };
  }
  return null;
}
