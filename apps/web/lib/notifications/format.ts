export function notificationTitle(type: string, payload: Record<string, unknown> = {}) {
  const fromPayload = payload.title ?? payload.headline ?? payload.subject;
  if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload.trim();
  return type.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function notificationBody(payload: Record<string, unknown> = {}) {
  const fromPayload = payload.body ?? payload.message ?? payload.detail ?? payload.summary;
  if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload.trim();
  return null;
}

export function notificationHref(
  type: string,
  payload: Record<string, unknown> = {},
  orgId: string | null = null,
) {
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
      return orgId ? `/team${orgQuery}` : "/team";
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
