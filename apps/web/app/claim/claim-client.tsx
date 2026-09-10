"use client";

import { useState } from "react";
import { LegalAgreementCheckbox } from "../../components/legal-agreement-checkbox";
import { EmptyState, FormGrid, FormRow, PageHeader, Button } from "../../components/ui";
import { legalConsentComplete, legalConsentMessage } from "../../lib/legal";

export default function ClaimWorkspaceClient() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [teamNumber, setTeamNumber] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState("");

  const consentComplete = legalConsentComplete({ terms: termsAccepted, privacy: privacyAccepted });

  async function submit() {
    setError("");
    if (!consentComplete) {
      // Shown once, next to the box that is still unticked.
      setLegalError(
        legalConsentMessage({ terms: termsAccepted, privacy: privacyAccepted }) ??
          "Agree to the Terms of Service and the Privacy Policy to continue.",
      );
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
      }),
    });
    const data = (await response.json()) as { id?: string; error?: string };
    if (!response.ok || !data.id) {
      setError(data.error ?? "Could not claim this team.");
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
          {error ? <p className="app-muted">{error}</p> : null}
          <Button type="button" variant="primary" disabled={!consentComplete} onClick={() => void submit()}>
            Claim team
          </Button>
        </FormGrid>
      )}
    </main>
  );
}
