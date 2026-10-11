"use client";

import { ROLE_LABELS, selfDescribedWords, suggestedRoleFor } from "@vantage/core/role-words";
import type { AccessRequest } from "./team-admin-model";

/** "a parent" → "A parent"; the onboarding answer as they gave it. */
function saidWords(teamRole: string | null): string {
  const words = selfDescribedWords(teamRole);
  if (words) return words.charAt(0).toUpperCase() + words.slice(1);
  return teamRole === "other" ? "Something else" : "Not specified";
}

export function TeamAdminAccessPanel({
  accessRequests,
  message,
  canApproveMentor = false,
  onReview,
}: {
  accessRequests: AccessRequest[];
  message: string;
  /** Only the owner lets someone in as a mentor or coach (0721 checks it too). */
  canApproveMentor?: boolean;
  onReview: (requestId: string, decision: "approved" | "declined", role?: "admin" | "scout" | "viewer") => void;
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
        {accessRequests.filter((request) => request.status === "pending").map((request) => {
          // The access their answer suggests goes first (a mentor could only be let in as a
          // student or a parent before: QA A3-17).
          const fits = suggestedRoleFor(request.requestedTeamRole);
          const choices = (["scout", "viewer", "admin"] as const)
            .filter((role) => role !== "admin" || canApproveMentor)
            .sort((a, b) => (a === fits ? -1 : b === fits ? 1 : 0));
          return (
            <article key={request.id}>
              <div className="team-access-person">
                <span>{request.name?.slice(0, 1).toUpperCase() || "?"}</span>
                <div>
                  <strong>{request.name || "Unnamed applicant"}</strong>
                  <small>{request.email}</small>
                </div>
              </div>
              <dl>
                <div><dt>Says they are</dt><dd>{saidWords(request.requestedTeamRole)}</dd></div>
                <div><dt>Job on the team</dt><dd>{request.crewRole ?? "Not specified"}</dd></div>
                <div><dt>Mostly works on</dt><dd>{request.primaryFocus}</dd></div>
                {request.roleDescription ? (
                  <div><dt>How they help</dt><dd>{request.roleDescription}</dd></div>
                ) : null}
                <div><dt>Asked on</dt><dd>{new Date(request.createdAt).toLocaleDateString()}</dd></div>
              </dl>
              <div className="team-access-actions">
                {choices.map((role, index) => (
                  <button
                    key={role}
                    type="button"
                    className={index === 0 ? "approve" : undefined}
                    onClick={() => onReview(request.id, "approved", role)}
                  >
                    Allow as {ROLE_LABELS[role].toLowerCase()}
                  </button>
                ))}
                <button type="button" className="decline" onClick={() => onReview(request.id, "declined")}>Decline</button>
              </div>
              {fits === "admin" && !canApproveMentor ? (
                <p className="app-muted">Only the team owner can let someone in as a mentor or coach.</p>
              ) : null}
            </article>
          );
        })}
      </div>
      {message ? <p className="team-access-message" role="status">{message}</p> : null}
    </section>
  );
}
