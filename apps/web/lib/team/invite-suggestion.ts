import { roleLabel } from "@vantage/core/role-words";

/** "It goes to Quinn Owner and Mo Mentor." — who will see a suggestion. */
export function teamLeadsLine(names: string[]): string {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return `It goes to ${clean[0]}.`;
  if (clean.length <= 3) return `It goes to ${clean.slice(0, -1).join(", ")} and ${clean.at(-1)}.`;
  return `It goes to ${clean.slice(0, 2).join(", ")} and ${clean.length - 2} others who run the team.`;
}

/** After sending: who heard, and what happens next. */
export function suggestionSentMessage(email: string, notified: number): string {
  const who = notified === 1 ? "The person who runs your team" : `${notified} people who run your team`;
  return `Sent. ${who} got a notice to invite ${email}. They send the invite; you don't need to do anything else.`;
}

/**
 * The owner's inbox row for a suggestion (the notice carries only facts: who asked, the address,
 * the access suggested and an optional note). The link opens Team admin's invite form with the
 * address and access filled in, so inviting is one tap.
 */
export function inviteSuggestionCopy(payload: Record<string, unknown>, orgId: string | null): {
  title: string;
  body: string;
  href: string;
} {
  const from = typeof payload.fromName === "string" && payload.fromName.trim() ? payload.fromName.trim() : "A teammate";
  const email = typeof payload.email === "string" ? payload.email : "";
  const role = typeof payload.suggestedRole === "string" ? payload.suggestedRole : "";
  const note = typeof payload.note === "string" && payload.note.trim() ? payload.note.trim() : "";
  const params = new URLSearchParams();
  if (orgId) params.set("orgId", orgId);
  params.set("invite", "1");
  if (email) params.set("email", email);
  if (role === "admin" || role === "scout" || role === "viewer") params.set("role", role);
  return {
    title: `${from} asks you to invite ${email || "someone"}`,
    body: `As ${roleLabel(role)}.${note ? ` "${note}"` : ""} Open Team admin to send the invite.`,
    href: `/team/admin?${params.toString()}#invite`,
  };
}
