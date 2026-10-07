"use client";

import { useEffect, useRef, useState } from "react";
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
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";

const UNCONFIRMED_CREATION = "Team creation could not be confirmed. Your details are still here. Check Your teams before retrying in case creation finished.";

export default function ClaimWorkspaceClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [teamNumber, setTeamNumber] = useState("");
  const [joinPin, setJoinPin] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [authorizedError, setAuthorizedError] = useState<string | null>(null);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/onboarding", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]) })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data?.preferredTeamNumber || controller.signal.aborted) return;
        setTeamNumber((current) => current || String(data.preferredTeamNumber));
        setName((current) => current || `Team ${data.preferredTeamNumber}`);
        setSlug((current) => current || `frc-${data.preferredTeamNumber}`);
      })
      .catch(() => {});
    return () => controller.abort();
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
  const validTeam = /^\d{1,5}$/.test(typedTeam) && Number(typedTeam) > 0;
  const canSubmit = name.trim().length > 0 && validTeam &&
    consentComplete && authorized && (!joinPin || joinPin.length === 6);

  async function submit() {
    if (submittingRef.current) return;
    setError("");
    setAlreadyClaimed(false);
    if (!name.trim() || !validTeam) { setError("Enter your team's name and a number from 1 to 99999."); return; }
    if (joinPin && !/^\d{6}$/.test(joinPin)) { setError("Use a six-digit team code, or leave it blank to generate one."); return; }
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
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await fetch("/api/organizations/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        body: JSON.stringify({
          name: name.trim(),
          slug,
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
      if (!response.ok || typeof data.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)) {
        const message = response.ok ? UNCONFIRMED_CREATION : typeof data.error === "string" ? data.error : "Could not claim this team.";
        setError(message);
        setAlreadyClaimed(/already has a Vantage workspace/i.test(message));
        return;
      }
      router.push(`/dashboard?orgId=${encodeURIComponent(data.id)}`);
    } catch {
      setError(UNCONFIRMED_CREATION);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main className="module-page">
      <PageHeader
        title="Claim your FRC team"
        description="Create your team's workspace, then invite people by email or share your team join code."
      />
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={submitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <FormGrid>
        <FormRow label="Team name">
          <input
            value={name}
            maxLength={160}
            autoComplete="organization"
            onChange={(event) => setName(event.target.value)}
          />
        </FormRow>
        <FormRow label="FRC team number">
          <input
            value={teamNumber}
            onChange={(event) => {
              const number = event.target.value.replace(/\D/g, "").slice(0, 5);
              setTeamNumber(number);
              setAuthorized(false);
              if (!slug || /^frc-\d*$/.test(slug)) setSlug(`frc-${number}`);
            }}
            inputMode="numeric"
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
              disabled={!validTeam}
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
        {error ? <p role="alert">{error} <a href="/account/teams">Your teams</a></p> : null}
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
          disabled={!canSubmit || submitting}
        >
          {submitting ? "Creating team…" : "Create team"}
        </Button>
        <p className="app-muted">
          You’ll manage this team first. Invite your lead, then hand over the
          team from People whenever you’re ready.
        </p>
        {!alreadyClaimed ? <p className="app-muted">
          <a href={teamClaimReportHref(typedTeam)}>
            Report a team claimed without authorization
          </a>
        </p> : null}
      </FormGrid>
      </fieldset>
      </form>
    </main>
  );
}
