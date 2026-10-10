export function assignmentWorkspaceHref(input: { orgId?: string; eventKey?: string; matchKey?: string; qualsOnly?: boolean; view?: "review" }) {
  const params = new URLSearchParams();
  if (input.orgId) params.set("orgId", input.orgId);
  if (input.eventKey) params.set("eventKey", input.eventKey);
  if (input.matchKey) params.set("matchKey", input.matchKey);
  if (input.qualsOnly === false) params.set("qualsOnly", "0");
  if (input.view) params.set("view", input.view);
  return `/scout-coverage-live${params.size ? `?${params}` : ""}`;
}
