import { formatInviteRole } from "../invite/invite-flow";

export type InviteDeliveryMode = "resend" | "local" | "unconfigured" | "failed";

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

/** Copy shown after create/resend — never claim email went out when it did not. */
export function inviteSendResultCopy(input: {
  emailSent: boolean;
  delivery: InviteDeliveryMode;
  emailError?: string | null;
}): { tone: "ok" | "warn" | "error"; message: string } {
  if (input.delivery === "local") {
    return {
      tone: "warn",
      message:
        "Invite created. Local mode does not send email — copy the link and share it with that person.",
    };
  }
  if (input.delivery === "unconfigured" || (input.delivery === "failed" && !input.emailSent)) {
    return {
      tone: "warn",
      message:
        input.emailError?.trim() ||
        "Invite created, but email could not be sent. Copy the link and share it.",
    };
  }
  if (input.emailSent) {
    return {
      tone: "ok",
      message: "Invitation emailed. You can also copy the link if they do not see it.",
    };
  }
  return {
    tone: "warn",
    message: "Invite created. Copy the link and share it with that email.",
  };
}

export function inviteDeliveryBanner(mode: InviteDeliveryMode | null | undefined): {
  tone: "setup" | "info";
  title: string;
  detail: string;
} | null {
  if (mode === "unconfigured") {
    return {
      tone: "setup",
      title: "Email sending is not configured",
      detail:
        "Invites still work — copy the link after you send. Email sending is not configured on this deployment.",
    };
  }
  if (mode === "local") {
    return {
      tone: "info",
      title: "Local invites do not email",
      detail: "After you send, copy the invite link and share it.",
    };
  }
  return null;
}
