"use client";

import "./legal-agreement-checkbox.css";

export type LegalAgreement = {
  terms: boolean;
  privacy: boolean;
};

type Props = {
  /** Base id; each checkbox gets `${id}-terms` / `${id}-privacy`. */
  id: string;
  terms: boolean;
  privacy: boolean;
  onChange: (next: LegalAgreement) => void;
  /** Wrapper class kept for page-level layout (grid placement, spacing). */
  className?: string;
  required?: boolean;
  disabled?: boolean;
  /** Shown under the boxes and tied to both inputs via aria-describedby. */
  error?: string | null;
};

/**
 * Two independently required consents. A single combined checkbox cannot show
 * that someone agreed to the Privacy Policy specifically, so Terms and Privacy
 * are asked separately and each links its own document in a new tab.
 */
export function LegalAgreementCheckbox({
  id,
  terms,
  privacy,
  onChange,
  className = "",
  required = true,
  disabled = false,
  error = null,
}: Props) {
  const termsId = `${id}-terms`;
  const privacyId = `${id}-privacy`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : undefined;

  return (
    <div className={`legal-consent ${className}`.trim()}>
      <label className="legal-consent-row" htmlFor={termsId}>
        <input
          id={termsId}
          name="termsAccepted"
          type="checkbox"
          checked={terms}
          required={required}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange({ terms: event.target.checked, privacy })}
        />
        <span>
          I agree to the{" "}
          <a href="/terms" target="_blank" rel="noopener noreferrer">
            Terms of Service
          </a>
          .
        </span>
      </label>

      <label className="legal-consent-row" htmlFor={privacyId}>
        <input
          id={privacyId}
          name="privacyAccepted"
          type="checkbox"
          checked={privacy}
          required={required}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange({ terms, privacy: event.target.checked })}
        />
        <span>
          I agree to the{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>
          .
        </span>
      </label>

      {error ? (
        <p className="legal-consent-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
