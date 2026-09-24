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
  // Nothing to approve, nothing to show: an empty inbox was 270px of explanation on
  // every visit. It appears the moment someone asks to join.
  if (!accessRequests.some((request) => request.status === "pending")) return null;
  return (
    <section className="team-access-inbox" aria-labelledby="team-access-title">
      <header>
        <div>
          <h2 id="team-access-title">Asking to join</h2>
          <p>These people asked to join your team. Approving emails them a sign-in link.</p>
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
              <div><dt>Says they are</dt><dd>{request.requestedTeamRole ?? "Not specified"}</dd></div>
              <div><dt>Job on the team</dt><dd>{request.crewRole ?? "Not specified"}</dd></div>
              <div><dt>Mostly works on</dt><dd>{request.primaryFocus}</dd></div>
              {request.roleDescription ? (
                <div><dt>How they help</dt><dd>{request.roleDescription}</dd></div>
              ) : null}
              <div><dt>Asked on</dt><dd>{new Date(request.createdAt).toLocaleDateString()}</dd></div>
            </dl>
            <div className="team-access-actions">
              <button type="button" className="approve" onClick={() => onReview(request.id, "approved", "scout")}>Allow as student</button>
              <button type="button" onClick={() => onReview(request.id, "approved", "viewer")}>Allow as parent or guest</button>
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
