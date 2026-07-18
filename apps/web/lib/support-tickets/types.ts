export const SUPPORT_TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export type SupportTicket = {
  id: string;
  orgId: string;
  userId: string;
  subject: string;
  body: string;
  status: SupportTicketStatus;
  adminResponse: string | null;
  adminUserId: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupportTicketMemberView = {
  status: "live" | "setup_required";
  message?: string;
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  tickets: SupportTicket[];
};

export type SupportTicketAdminRow = SupportTicket & {
  orgName: string | null;
  teamNumber: number | null;
  submitterName: string | null;
  submitterEmail: string | null;
  adminName: string | null;
};

export function isSupportTicketStatus(value: unknown): value is SupportTicketStatus {
  return typeof value === "string" && (SUPPORT_TICKET_STATUSES as readonly string[]).includes(value);
}

export function statusLabel(status: SupportTicketStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "in_progress":
      return "In progress";
    case "resolved":
      return "Resolved";
    case "closed":
      return "Closed";
  }
}
