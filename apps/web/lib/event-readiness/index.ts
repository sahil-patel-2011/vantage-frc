// Pure helpers for pre-event readiness — no I/O, unit-testable in isolation.

/** Delete matches event_readiness_items RLS: the author, or an owner or admin. */
export function canDeleteEventReadinessItem(input: {
  role?: string | null;
  userId?: string | null;
  authorId?: string | null;
}): boolean {
  const role = (input.role ?? "").toLowerCase();
  if (role === "owner" || role === "admin") return true;
  const userId = input.userId ?? "";
  const authorId = input.authorId ?? "";
  return userId.length > 0 && userId === authorId;
}

export * from "./types";
export * from "./template";
export * from "./schedule";
export * from "./blockers";
