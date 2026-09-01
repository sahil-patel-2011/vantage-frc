"use client";

import { useEffect, useState } from "react";
import { LegalAgreementCheckbox } from "../../components/legal-agreement-checkbox";
import { EmptyState, FormGrid, FormRow, PageHeader } from "../../components/ui";
import { legalConsentComplete, legalConsentMessage } from "../../lib/legal";

type JoinResult = { name: string; teamNumber: number; role: string };

export default function JoinByCodeClient() {
  const [code, setCode] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joined, setJoined] = useState<JoinResult | null>(null);

  const consentComplete = legalConsentComplete({ terms: termsAccepted, privacy: privacyAccepted });

  // Owners share /join?code=ABCD2345 straight from the team admin panel. Prefill the
  // field so the recipient only has to accept the agreements — but never auto-submit,
  // because consent has to be a deliberate action.
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("code");
    if (fromLink) setCode(fromLink.trim().toUpperCase().slice(0, 12));
  }, []);

  async function submit() {
    setError("");
    if (!consentComplete) {
      setLegalError(
        legalConsentMessage({ terms: termsAccepted, privacy: privacyAccepted }) ??
          "Agree to the Terms of Service and the Privacy Policy to continue.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json()) as Partial<JoinResult> & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not redeem that join code.");
        return;
      }
      setJoined({
        name: data.name ?? "",
        teamNumber: Number(data.teamNumber ?? 0),
        role: data.role ?? "scout",
      });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="module-page">
      <PageHeader
        title="Join your team"
        description="Enter the join code an owner or admin gave you. A code adds you to that one team as a scout or viewer — leadership roles are always assigned separately."
      />
      {joined ? (
        <EmptyState
          title={
            joined.teamNumber
              ? `You joined Team ${joined.teamNumber}`
              : "You joined the team"
          }
          description={`${joined.name ? `${joined.name}. ` : ""}You are in as ${joined.role}. Your team's dashboard is ready.`}
        >
          <a className="app-button" href="/dashboard">
            Open dashboard
          </a>
        </EmptyState>
      ) : (
        <FormGrid>
          <FormRow label="Join code">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABCD2345"
              autoComplete="off"
              spellCheck={false}
              maxLength={12}
              aria-describedby="join-code-hint"
            />
          </FormRow>
          <p id="join-code-hint" className="app-muted">
            Codes are 6–12 characters and skip the letters I and O so they are easy to read
            aloud.
          </p>
          <LegalAgreementCheckbox
            id="join-legal"
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
          <button
            type="button"
            className="app-button"
            disabled={!consentComplete || submitting || code.trim().length < 6}
            onClick={() => void submit()}
          >
            {submitting ? "Joining…" : "Join team"}
          </button>
        </FormGrid>
      )}
    </main>
  );
}
