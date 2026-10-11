"use client";

import { useEffect, useState } from "react";
import { LegalAgreementCheckbox } from "./legal-agreement-checkbox";
import { LEGAL_LAST_UPDATED } from "../lib/legal/documents";
import "./legal-update-banner.css";

/** "Hide": asked again on the next visit (a new tab or session), never silently accepted. */
const LATER_KEY = "vantage.legal.later";

/**
 * "We updated the Terms and Privacy Policy", once, for someone who accepted an earlier version.
 * It does not block anything: the two boxes and one button record the new acceptance, the same
 * two consents onboarding asks for.
 *
 * It floats above the bottom bar instead of sitting in the page. It can only know it is needed
 * after /api/legal answers, and in the page it then pushed everything down 56-66px: the biggest
 * single layout shift on Account and Business, landing under a thumb mid-tap. Hide puts it away
 * until the next visit.
 *
 * On a phone it is one line and a Review button until opened: the full sentence, its link and
 * a wrapping button took a fifth of the first screen, and with the event bar under it most of
 * it. Opening it shows the sentence, the short-version link and the two boxes, so the consent
 * reads exactly as it does on a computer.
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
      if (window.sessionStorage.getItem(LATER_KEY) === "1") return;
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

  function later() {
    try {
      window.sessionStorage.setItem(LATER_KEY, "1");
    } catch {
      // Private mode: hidden on this page only.
    }
    setNeeded(false);
  }

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
    <section
      className="legal-update"
      role="region"
      aria-label="Updated Terms and Privacy Policy"
      data-testid="legal-update"
      data-open={open ? "true" : "false"}
    >
      <p>
        {/* Phone, closed: this line alone. Everything after it is the full notice. */}
        <strong className="legal-update-short">Terms and Privacy updated</strong>
        <span className="legal-update-full">
          <strong>We rewrote our Terms and Privacy Policy</strong> ({LEGAL_LAST_UPDATED}): plainer words, a short version
          at the top, and exactly where AI requests go.{" "}
          <a href="/privacy#summary" target="_blank" rel="noopener noreferrer">
            Read the short version
          </a>
        </span>
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
          <span className="legal-update-full">Review and accept</span>
          <span className="legal-update-short">Review</span>
        </button>
      )}
      <button type="button" className="legal-update-later" onClick={later} aria-label="Hide until next time">
        <span aria-hidden="true">×</span>
      </button>
    </section>
  );
}
