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
    default:
      return null;
  }
}
