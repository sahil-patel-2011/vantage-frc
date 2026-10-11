"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LegalAgreementCheckbox } from "../../components/legal-agreement-checkbox";
import { FormGrid, FormRow, PageHeader, Button } from "../../components/ui";
import {
  CLAIM_ATTESTATION_MISSING_MESSAGE,
  TEAM_CLAIM_STATEMENT_VERSION,
  teamClaimReportHref,
  teamClaimStatement,
} from "../../lib/claim/attestation";
import { legalConsentComplete, legalConsentMessage } from "../../lib/legal";
import {
  EMPTY_CLAIM_FIELDS,
  claimPrefill,
  claimNameToSubmit,
  claimSlugToSubmit,
  withClaimTeamNumber,
  type ClaimFields,
} from "../../lib/claim/claim-form";
import { requestMe } from "../../lib/nav/me-request";
import "./claim.css";

export default function ClaimWorkspaceClient() {
  const router = useRouter();
  const [fields, setFields] = useState<ClaimFields>(EMPTY_CLAIM_FIELDS);
  const { name, teamNumber } = fields;
  const [joinPin, setJoinPin] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [authorizedError, setAuthorizedError] = useState<string | null>(null);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Blank by default. Only an explicit ?teamNumber= (onboarding links here once the server said
  // that number has no workspace) fills the form, and never with a team this person is already
  // on: the saved team number used to prefill a team that already had a workspace.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("teamNumber");
    if (!requested) return;
    let cancelled = false;
    void requestMe(null).then((me) => {
      if (cancelled) return;
      const memberships = (me.data as { memberships?: Array<{ teamNumber?: number | null }> } | null)?.memberships ?? [];
      const prefill = claimPrefill(requested, memberships.map((row) => row.teamNumber));
      setFields((current) => (current.teamNumber || current.name ? current : prefill));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const consentComplete = legalConsentComplete({
    terms: termsAccepted,
    privacy: privacyAccepted,
  });
  const typedTeam = teamNumber.trim();
  // The statement names the team being claimed; until a number is typed it
  // reads "Team N" so nobody ticks a promise about a team they have not named.
  const statement = teamClaimStatement(
    /^\d{1,5}$/.test(typedTeam) ? typedTeam : "N",
  );
  const canSubmit =
    consentComplete &&
    authorized &&
    /^\d{1,5}$/.test(typedTeam) &&
    Number(typedTeam) >= 1 &&
    claimNameToSubmit(fields).length >= 2 &&
    (!joinPin || joinPin.length === 6);

  async function submit() {
    setError("");
    setAlreadyClaimed(false);
    if (!consentComplete) {
      // Shown once, next to the box that is still unticked.
      setLegalError(
        legalConsentMessage({
          terms: termsAccepted,
          privacy: privacyAccepted,
        }) ??
          "Agree to the Terms of Service and the Privacy Policy to continue.",
      );
      return;
    }
    if (!authorized) {
      setAuthorizedError(CLAIM_ATTESTATION_MISSING_MESSAGE);
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/organizations/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: claimNameToSubmit(fields),
          slug: claimSlugToSubmit(fields),
          teamNumber: Number(teamNumber),
          joinPin: joinPin || undefined,
          termsAccepted,
          privacyAccepted,
          authorizationAcknowledged: authorized,
          attestationVersion: TEAM_CLAIM_STATEMENT_VERSION,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
      if (!response.ok || !data.id) {
        const message = data.error ?? "Could not claim this team.";
        setError(message);
        setAlreadyClaimed(/already has a Vantage workspace/i.test(message));
        return;
      }
      router.push(`/dashboard?orgId=${encodeURIComponent(data.id)}`);
    } catch {
      setError("Could not reach Vantage. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="module-page">
      <PageHeader
        title="Claim your FRC team"
        description="Create your team's workspace, then invite people by email or share your team join code."
      />
      <form
        className="claim-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !submitting) void submit();
        }}
      >
        <FormGrid min={200} className="claim-fields">
          <FormRow label="FRC team number">
            <input
              value={teamNumber}
              onChange={(event) => setFields((current) => withClaimTeamNumber(current, event.target.value))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 6925"
              required
            />
          </FormRow>
          <FormRow label="Team name" hint="Follows the number until you type your own.">
            <input
              value={name}
              onChange={(event) => setFields((current) => ({ ...current, name: event.target.value }))}
              placeholder={teamNumber ? `Team ${teamNumber}` : "Team name"}
              autoComplete="organization"
              required
            />
          </FormRow>
          <FormRow label="Team join code (optional)">
            <input
              aria-describedby="claim-pin-help"
              value={joinPin}
              onChange={(event) =>
                setJoinPin(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="Generate one for me"
            />
            <small id="claim-pin-help" className="app-muted">
              Six numbers. Leave blank for a random code. Find it later under
              People.
            </small>
          </FormRow>
        </FormGrid>
        <div className="claim-consents">
          <LegalAgreementCheckbox
            id="claim-legal"
            terms={termsAccepted}
            privacy={privacyAccepted}
            onChange={(next) => {
              setTermsAccepted(next.terms);
              setPrivacyAccepted(next.privacy);
              setLegalError(
                legalConsentMessage({ terms: next.terms, privacy: next.privacy }),
              );
            }}
            error={legalError}
            required
          />
          <div className="legal-consent">
            <label className="legal-consent-row" htmlFor="claim-authorized">
              <input
                id="claim-authorized"
                name="authorizationAcknowledged"
                type="checkbox"
                checked={authorized}
                required
                aria-describedby={
                  authorizedError
                    ? "claim-authorized-error"
                    : "claim-authorized-note"
                }
                onChange={(event) => {
                  setAuthorized(event.target.checked);
                  setAuthorizedError(
                    event.target.checked
                      ? null
                      : CLAIM_ATTESTATION_MISSING_MESSAGE,
                  );
                }}
              />
              <span>{statement}</span>
            </label>
            <p className="app-muted" id="claim-authorized-note">
              This statement is saved with the team, as described in{" "}
              <a
                href="/terms#team-identities"
                target="_blank"
                rel="noopener noreferrer"
              >
                Team identities and team numbers
              </a>
              .
            </p>
            {authorizedError ? (
              <p
                className="legal-consent-error"
                id="claim-authorized-error"
                role="alert"
              >
                {authorizedError}
              </p>
            ) : null}
          </div>
        </div>
        {error ? <p className="app-muted" role="alert">{error}</p> : null}
        {alreadyClaimed ? (
          <p className="app-muted">
            Think this team was claimed by someone who does not represent it?{" "}
            <a href={teamClaimReportHref(typedTeam)}>
              Report a team claimed without authorization
            </a>
            .
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          className="claim-submit"
          disabled={!canSubmit || submitting}
        >
          {submitting ? "Creating team…" : "Create team"}
        </Button>
        <p className="app-muted">
          You’ll manage this team first. Invite your lead, then hand over the
          team from People whenever you’re ready.
        </p>
        {alreadyClaimed ? null : (
          <p className="app-muted">
            <a href={teamClaimReportHref(typedTeam)}>
              Report a team claimed without authorization
            </a>
          </p>
        )}
      </form>
    </main>
  );
}
