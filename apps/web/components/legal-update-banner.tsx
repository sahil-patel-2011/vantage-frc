"use client";

import { useEffect, useState } from "react";
import { LegalAgreementCheckbox } from "./legal-agreement-checkbox";
import { LEGAL_LAST_UPDATED } from "../lib/legal/documents";
import "./legal-update-banner.css";

/**
 * "We updated the Terms and Privacy Policy", once, for someone who accepted an earlier version.
 * In the page, never over it, and it does not block anything: the two boxes and one button record
 * the new acceptance, the same two consents onboarding asks for.
 */
export function LegalUpdateBanner() {
  const [needed, setNeeded] = useState(false);
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState({ terms: false, privacy: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    try {
      if (window.sessionStorage.getItem("vantage.legal.accepted") === "1") return;
    } catch {
      // Private mode: ask the server.
    }
    fetch("/api/legal", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { updateRequired?: boolean } | null) => {
        if (!cancelled && data?.updateRequired) setNeeded(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!needed) return null;

  async function accept() {
    if (!agreed.terms || !agreed.privacy) {
      setError("Tick both boxes to accept.");
      return;
    }
    setSaving(true);
    setError(null);
    const response = await fetch("/api/legal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ termsAccepted: true, privacyAccepted: true }),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      setError("Couldn't save that. Try again.");
      return;
    }
    try {
      window.sessionStorage.setItem("vantage.legal.accepted", "1");
    } catch {
      // Nothing to remember in private mode; the server has the record.
    }
    setNeeded(false);
  }

  return (
    <section className="legal-update" role="region" aria-label="Updated Terms and Privacy Policy" data-testid="legal-update">
      <p>
        <strong>We rewrote our Terms and Privacy Policy</strong> ({LEGAL_LAST_UPDATED}): plainer words, a short version at
        the top, and exactly where AI requests go.{" "}
        <a href="/privacy#summary" target="_blank" rel="noopener noreferrer">
          Read the short version
        </a>
      </p>
      {open ? (
        <div className="legal-update-form">
          <LegalAgreementCheckbox
            id="legal-update"
            terms={agreed.terms}
            privacy={agreed.privacy}
            onChange={(next) => {
              setAgreed(next);
              setError(null);
            }}
            error={error}
          />
          <button type="button" className="app-button" disabled={saving} onClick={() => void accept()}>
            {saving ? "Saving…" : "Accept"}
          </button>
        </div>
      ) : (
        <button type="button" className="app-button secondary" onClick={() => setOpen(true)}>
          Review and accept
        </button>
      )}
    </section>
  );
}
