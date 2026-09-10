"use client";

import type { AccessRequest } from "./team-admin-model";

export function TeamAdminAccessPanel({
  accessRequests,
  message,
  onReview,
}: {
  accessRequests: AccessRequest[];
  message: string;
  onReview: (requestId: string, decision: "approved" | "declined", role?: "scout" | "viewer") => void;
}) {
  return (
    <section className="team-access-inbox" aria-labelledby="team-access-title">
      <header>
        <div>
          <span className="eyebrow">VERIFIED ACCESS REQUESTS</span>
          <h2 id="team-access-title">Approve who enters this team.</h2>
          <p>Team numbers route requests here; they never grant membership. Approval ends the applicant&apos;s onboarding sessions and emails a fresh sign-in link.</p>
        </div>
        <strong>{accessRequests.filter((request) => request.status === "pending").length}</strong>
      </header>
      <div className="team-access-list">
        {accessRequests.filter((request) => request.status === "pending").map((request) => (
          <article key={request.id}>
            <div className="team-access-person">
              <span>{request.name?.slice(0, 1).toUpperCase() || "?"}</span>
              <div>
                <strong>{request.name || "Unnamed applicant"}</strong>
                <small>{request.email}</small>
              </div>
            </div>
            <dl>
              <div><dt>TEAM ROLE</dt><dd>{request.requestedTeamRole ?? "Not specified"}</dd></div>
              <div><dt>CREW</dt><dd>{request.crewRole ?? "Not specified"}</dd></div>
              <div><dt>PRIMARY FOCUS</dt><dd>{request.primaryFocus}</dd></div>
              {request.roleDescription ? (
                <div><dt>HOW THEY HELP</dt><dd>{request.roleDescription}</dd></div>
              ) : null}
              <div><dt>REQUESTED</dt><dd>{new Date(request.createdAt).toLocaleDateString()}</dd></div>
            </dl>
            <div className="team-access-actions">
              <button type="button" className="approve" onClick={() => onReview(request.id, "approved", "scout")}>Allow as scout</button>
              <button type="button" onClick={() => onReview(request.id, "approved", "viewer")}>Allow view-only</button>
              <button type="button" className="decline" onClick={() => onReview(request.id, "declined")}>Decline</button>
            </div>
          </article>
        ))}
        {!accessRequests.some((request) => request.status === "pending") ? (
          <div className="team-access-empty"><b>✓</b><div><strong>No access requests waiting</strong><span>New verified requests will appear here for an owner or administrator.</span></div></div>
        ) : null}
      </div>
      {message ? <p className="team-access-message" role="status">{message}</p> : null}
    </section>
  );
}
