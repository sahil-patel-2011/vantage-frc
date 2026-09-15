"use client";

import { useEffect, useState } from "react";
import { AppleQolBoot } from "../../components/apple-qol-boot";
import { VantageLogo } from "../../components/brand";
import { LegalAgreementCheckbox } from "../../components/legal-agreement-checkbox";
import { EmptyState, FormGrid, FormRow, PageHeader, Button } from "../../components/ui";
import { CLAIM_DENIED_MESSAGE, claimOneAccountCopy, claimSignInHref, slugFromTeamName } from "../../lib/claim/claim-flow";
import { legalConsentComplete, legalConsentMessage } from "../../lib/legal";
import "../product-styles";
import "../invite/invite-flow.css";

export default function ClaimWorkspaceClient() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [teamNumber, setTeamNumber] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);

  const consentComplete = legalConsentComplete({ terms: termsAccepted, privacy: privacyAccepted });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await fetch("/api/auth/get-session");
        const data = (await session.json().catch(() => null)) as { user?: { id?: string } } | null;
        if (cancelled) return;
        setSignedIn(Boolean(data?.user?.id));
        const intent = await fetch("/api/organizations/claim/start");
        const preview = (await intent.json().catch(() => ({}))) as { teamNumber?: number | null };
        if (cancelled) return;
        if (preview.teamNumber) {
          setTeamNumber(String(preview.teamNumber));
          setStarted(true);
        }
      } catch {
        if (!cancelled) setSignedIn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateName(value: string) {
    setName(value);
    if (!slugTouched) {
      const parsed = Number(teamNumber);
      setSlug(slugFromTeamName(value, Number.isInteger(parsed) ? parsed : 0));
    }
  }

  async function startClaim() {
    setBusy(true);
    setError("");
    try {
      const parsed = Number(teamNumber);
      const response = await fetch("/api/organizations/claim/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamNumber: parsed }),
      });
      const data = (await response.json()) as { error?: string; teamNumber?: number };
      if (!response.ok) {
        setError(data.error ?? CLAIM_DENIED_MESSAGE);
        return;
      }
      if (data.teamNumber) setTeamNumber(String(data.teamNumber));
      setStarted(true);
      if (!signedIn) window.location.href = claimSignInHref();
    } catch {
      setError("Could not start this claim.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError("");
    if (!consentComplete) {
      setLegalError(
        legalConsentMessage({ terms: termsAccepted, privacy: privacyAccepted }) ??
          "Agree to the Terms of Service and the Privacy Policy to continue.",
      );
      return;
    }
    setBusy(true);
    try {
      const parsed = Number(teamNumber);
      const response = await fetch("/api/organizations/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          slug: slug || slugFromTeamName(name, parsed),
          teamNumber: parsed,
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
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (signedIn === null) {
    return (
      <main className="onboarding-page invite-flow-page">
        <AppleQolBoot />
        <section className="onboarding-card invite-flow-card">
          <p className="onboarding-sub">Getting your claim steps ready…</p>
        </section>
      </main>
    );
  }

  if (!signedIn) {
    return (
      <main className="onboarding-page invite-flow-page">
        <AppleQolBoot />
        <section className="onboarding-card invite-flow-card">
          <header className="invite-flow-header">
            <VantageLogo />
            <span>COACH START</span>
            <h1>Create your team account</h1>
            <p className="onboarding-sub">
              Enter an unused FRC team number. Then sign in with Google or an email code. After that you
              can share one join link with up to 50 people.
            </p>
            <p className="onboarding-sub">{claimOneAccountCopy()}</p>
          </header>
          <label>
            FRC team number
            <input
              inputMode="numeric"
              value={teamNumber}
              onChange={(event) => setTeamNumber(event.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="6925"
            />
          </label>
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <div className="invite-next-actions">
            <Button variant="primary" type="button" disabled={busy || !teamNumber} onClick={() => void startClaim()}>
              {busy ? "Checking…" : "Continue with Google or email"}
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="module-page">
      <PageHeader
        title="Claim your FRC team"
        description="Coaches and mentors create the first team account here, then share one join link for up to 50 people. Same email is one account for Google and the email code."
      />
      {orgId ? (
        <EmptyState
          title="Team created"
          description="Share a join link so students can get an account and land on this team."
        >
          <Button as="a" variant="primary" href={`/team/admin?orgId=${encodeURIComponent(orgId)}#join-link`}>
            Create a join link
          </Button>
          <Button as="a" variant="secondary" href={`/migrate?orgId=${encodeURIComponent(orgId)}`}>
            Bring your season
          </Button>
        </EmptyState>
      ) : (
        <FormGrid>
          <FormRow label="FRC team number">
            <input
              value={teamNumber}
              onChange={(event) => setTeamNumber(event.target.value.replace(/\D/g, "").slice(0, 5))}
              inputMode="numeric"
            />
          </FormRow>
          <FormRow label="Team name">
            <input value={name} onChange={(event) => updateName(event.target.value)} />
          </FormRow>
          <FormRow label="URL slug">
            <input
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
              placeholder="cheesy-poofs"
            />
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
          {!started ? (
            <Button type="button" variant="secondary" disabled={busy || !teamNumber} onClick={() => void startClaim()}>
              {busy ? "Checking…" : "Check this number"}
            </Button>
          ) : null}
          <Button type="button" variant="primary" disabled={!consentComplete || busy} onClick={() => void submit()}>
            {busy ? "Working…" : "Claim team"}
          </Button>
        </FormGrid>
      )}
    </main>
  );
}
