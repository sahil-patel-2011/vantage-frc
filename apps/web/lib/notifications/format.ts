import { inviteSuggestionCopy } from "../team/invite-suggestion";

/** Student-readable inbox category — never a raw `todo_assigned` slug. */
export function notificationTypeLabel(type: string): string {
  switch (type) {
    case "todo_assigned":
    case "todo_completed":
      return "Todo";
    case "duty_assigned":
      return "Duty";
    case "calendar_event":
    case "calendar_updated":
      return "Calendar";
    case "dm_message":
    case "direct_message":
    case "message_mention":
    case "org_message":
    case "message":
      return "Chat";
    case "match_alert":
      return "Match";
    case "scout_reminder":
    case "scout_report_synced":
    case "scouting_coverage_gap":
    case "scouting_disagreement_resolved":
    case "scout_pick_influence":
      return "Scouting";
    case "product_update":
      return "What’s new";
    case "export_ready":
      return "Export";
    // Joins, and the team lifecycle (migration 0720, platform provisioning): someone left, the
    // team was deleted, or a new team was set up with you as its owner. Then your own access
    // (0721): changed, removed, handed the team; a teammate asking you to invite someone; and
    // the asking-to-join lifecycle.
    case "invite_accepted":
    case "member_left":
    case "team_deleted":
    case "team_owner_added":
    case "team_role_changed":
    case "team_removed":
    case "team_ownership_given":
    case "invite_suggestion":
    case "team_access_request":
    case "team_access_approved":
    case "team_access_declined":
      return "Team";
    case "guided_signoff_requested":
    case "guided_signoff_decided":
      return "Learning";
    case "billing":
    case "credit_low":
      return "AI limits";
    case "sponsor_thank_you_due":
    case "sponsor_renewal_due":
    case "sponsor_followup_overdue":
      return "Sponsors";
    case "purchase_request_submitted":
    case "purchase_request_approved":
    case "purchase_request_rejected":
    case "purchase_request_assigned":
      return "Orders";
    default:
      return type.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/** The asking-to-join row the database writes (0445, 0721) carries facts, not sentences. */
function accessRequestTitle(payload: Record<string, unknown>): string {
  const who = typeof payload.requesterName === "string" && payload.requesterName.trim() ? payload.requesterName.trim() : "Someone";
  const team = typeof payload.teamNumber === "number" ? `Team ${payload.teamNumber}` : "your team";
  return `${who} asked to join ${team}`;
}

export function notificationTitle(type: string, payload: Record<string, unknown> = {}) {
  const fromPayload = payload.title ?? payload.headline ?? payload.subject;
  if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload.trim();
  if (type === "invite_suggestion") return inviteSuggestionCopy(payload, null).title;
  if (type === "team_access_request") return accessRequestTitle(payload);
  return notificationTypeLabel(type);
}

export function notificationBody(payload: Record<string, unknown> = {}, type?: string) {
  const fromPayload = payload.body ?? payload.message ?? payload.detail ?? payload.summary;
  if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload.trim();
  if (type === "invite_suggestion") return inviteSuggestionCopy(payload, null).body;
  if (type === "team_access_request") {
    return "Review it in Team admin: let them in as a student, a parent or guest, or a mentor or coach, or decline.";
  }
  return null;
}

export function notificationHref(
  type: string,
  payload: Record<string, unknown> = {},
  orgId: string | null = null,
) {
  // The asking-to-join inbox is on Team admin; rows written before 0721 linked to /team.
  if (type === "team_access_request") {
    const org = orgId ?? (typeof payload.orgId === "string" ? payload.orgId : null);
    return org ? `/team/admin?orgId=${encodeURIComponent(org)}#team-access-title` : "/team/admin#team-access-title";
  }
  if (type === "invite_suggestion") return inviteSuggestionCopy(payload, orgId).href;
  const fromPayload = payload.href ?? payload.url ?? payload.link;
  if (typeof fromPayload === "string" && fromPayload.startsWith("/")) return fromPayload;
  const orgQuery = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  switch (type) {
    case "export_ready":
      return orgId ? `/exports${orgQuery}` : "/exports";
    case "dm_message":
    case "direct_message":
    case "message_mention":
    case "org_message":
    case "message": {
      const conversationId =
        typeof payload.conversationId === "string" && payload.conversationId
          ? payload.conversationId
          : null;
      if (orgId && conversationId) {
        return `/messages?orgId=${encodeURIComponent(orgId)}&conversationId=${encodeURIComponent(conversationId)}`;
      }
      return orgId ? `/messages${orgQuery}` : "/messages";
    }
    case "invite_accepted":
      // Straight to the people list, where the person who joined is.
      return orgId ? `/team/admin${orgQuery}` : "/team/admin";
    case "billing":
    case "credit_low":
      return orgId ? `/team/budgets${orgQuery}` : "/account";
    case "todo_assigned":
    case "todo_completed": {
      const todoId = payload.todoId;
      if (orgId && typeof todoId === "string" && todoId) {
        return `/todos?orgId=${encodeURIComponent(orgId)}&todoId=${encodeURIComponent(todoId)}`;
      }
      return orgId ? `/todos${orgQuery}` : "/todos";
    }
    case "duty_assigned": {
      const dutyId = payload.dutyId;
      if (orgId && typeof dutyId === "string" && dutyId) {
        return `/team/calendar?orgId=${encodeURIComponent(orgId)}&dutyId=${encodeURIComponent(dutyId)}`;
      }
      return orgId ? `/team/calendar${orgQuery}` : "/team/calendar";
    }
    case "calendar_event":
    case "calendar_updated": {
      const eventId = payload.eventId;
      if (orgId && typeof eventId === "string" && eventId) {
        return `/team/calendar?orgId=${encodeURIComponent(orgId)}&eventId=${encodeURIComponent(eventId)}`;
      }
      return orgId ? `/team/calendar${orgQuery}` : "/team/calendar";
    }
    case "scouting_coverage_gap":
    case "scout_reminder":
      return orgId ? `/command${orgQuery}` : "/command";
    case "match_alert":
      return orgId ? `/my-day${orgQuery}` : "/my-day";
    case "sponsor_thank_you_due":
    case "sponsor_renewal_due":
    case "sponsor_followup_overdue":
      return orgId ? `/business?orgId=${encodeURIComponent(orgId)}&tab=sponsors` : "/business?tab=sponsors";
    case "purchase_request_submitted":
    case "purchase_request_approved":
    case "purchase_request_rejected":
    case "purchase_request_assigned": {
      const orderId = payload.orderId;
      if (orgId && typeof orderId === "string" && orderId) {
        return `/orders?orgId=${encodeURIComponent(orgId)}&orderId=${encodeURIComponent(orderId)}`;
      }
      return orgId ? `/orders${orgQuery}` : "/orders";
    }
    case "product_update":
      return "/whats-new";
    case "scouting_disagreement_resolved":
      return orgId
        ? `/competition?tab=scouting&orgId=${encodeURIComponent(orgId)}&scoutTab=conflicts`
        : "/competition?tab=scouting";
    default:
      return null;
  }
}
