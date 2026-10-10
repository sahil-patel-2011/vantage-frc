/** A linked event is a read scope; it never changes the team's active event. */
export function scoutingBootstrapUrl(orgId: string, eventKey: string | null): string {
  const params = new URLSearchParams({ orgId });
  if (eventKey) params.set("eventKey", eventKey);
  return `/api/scouting/bootstrap?${params}`;
}

export function bootstrapForEvent<T extends { eventKey: string | null }>(value: T | null | undefined, eventKey: string | null): T | null {
  return value && (typeof value.eventKey === "string" || value.eventKey === null) && (!eventKey || value.eventKey === eventKey) ? value : null;
}
