"use client";

import { useState } from "react";
import { LegalAgreementCheckbox } from "../../components/legal-agreement-checkbox";
import { EmptyState, FormGrid, FormRow, PageHeader, Button } from "../../components/ui";
import {
  CLAIM_ATTESTATION_MISSING_MESSAGE,
  TEAM_CLAIM_STATEMENT_VERSION,
  teamClaimReportHref,
  teamClaimStatement,
} from "../../lib/claim/attestation";
import { legalConsentComplete, legalConsentMessage } from "../../lib/legal";

export default function ClaimWorkspaceClient() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [teamNumber, setTeamNumber] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [authorizedError, setAuthorizedError] = useState<string | null>(null);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [orgId, setOrgId] = useState("");

  const consentComplete = legalConsentComplete({ terms: termsAccepted, privacy: privacyAccepted });
  const typedTeam = teamNumber.trim();
  // The statement names the team being claimed; until a number is typed it
  // reads "Team N" so nobody ticks a promise about a team they have not named.
  const statement = teamClaimStatement(/^\d{1,5}$/.test(typedTeam) ? typedTeam : "N");
  const canSubmit = consentComplete && authorized;

  async function submit() {
    setError("");
    setAlreadyClaimed(false);
    if (!consentComplete) {
      // Shown once, next to the box that is still unticked.
      setLegalError(
        legalConsentMessage({ terms: termsAccepted, privacy: privacyAccepted }) ??
          "Agree to the Terms of Service and the Privacy Policy to continue.",
      );
      return;
    }
    if (!authorized) {
      setAuthorizedError(CLAIM_ATTESTATION_MISSING_MESSAGE);
      return;
    }
    const response = await fetch("/api/organizations/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        slug,
        teamNumber: Number(teamNumber),
        termsAccepted,
        privacyAccepted,
        authorizationAcknowledged: authorized,
        attestationVersion: TEAM_CLAIM_STATEMENT_VERSION,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!response.ok || !data.id) {
      const message = data.error ?? "Could not claim this team.";
      setError(message);
      setAlreadyClaimed(/already has a Vantage workspace/i.test(message));
      return;
    }
    setOrgId(data.id);
  }

  return (
    <main className="module-page">
      <PageHeader
        title="Claim your FRC team"
        description="Verified accounts can create one team per unused TBA team number. Members still join by exact-email invite. STIMS remains official FIRST registration."
      />
      {orgId ? (
        <EmptyState
          title="Team created"
          description="Invite your scouts next. Import Notion or ICS from Bring your season."
        >
            <Button as="a" variant="primary" href={`/migrate?orgId=${encodeURIComponent(orgId)}`}>
              Bring your season
            </Button>
        </EmptyState>
      ) : (
        <FormGrid>
          <FormRow label="Team name">
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </FormRow>
          <FormRow label="URL slug">
            <input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="cheesy-poofs" />
          </FormRow>
          <FormRow label="FRC team number">
            <input value={teamNumber} onChange={(event) => setTeamNumber(event.target.value)} inputMode="numeric" />
          </FormRow>
          <LegalAgreementCheckbox
            id="claim-legal"
            terms={termsAccepted}
            privacy={privacyAccepted}
            onChange={(next) => {
              setTermsAccepted(next.terms);
              setPrivacyAccepted(next.privacy);
              setLegalError(legalConsentMessage({ terms: next.terms, privacy: next.privacy }));
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
                aria-describedby={authorizedError ? "claim-authorized-error" : "claim-authorized-note"}
                onChange={(event) => {
                  setAuthorized(event.target.checked);
                  setAuthorizedError(event.target.checked ? null : CLAIM_ATTESTATION_MISSING_MESSAGE);
                }}
              />
              <span>{statement}</span>
            </label>
            <p className="app-muted" id="claim-authorized-note">
              This statement is saved with the team, as described in{" "}
              <a href="/terms#team-identities" target="_blank" rel="noopener noreferrer">
                Team identities and team numbers
              </a>
              .
            </p>
            {authorizedError ? (
              <p className="legal-consent-error" id="claim-authorized-error" role="alert">
                {authorizedError}
              </p>
            ) : null}
          </div>
          {error ? <p className="app-muted">{error}</p> : null}
          {alreadyClaimed ? (
            <p className="app-muted">
              Think this team was claimed by someone who does not represent it?{" "}
              <a href={teamClaimReportHref(typedTeam)}>Report a team claimed without authorization</a>.
            </p>
          ) : null}
          <Button type="button" variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            Claim team
          </Button>
          <p className="app-muted">
            <a href={teamClaimReportHref(typedTeam)}>Report a team claimed without authorization</a>
          </p>
        </FormGrid>
      )}
    </main>
  );
}
