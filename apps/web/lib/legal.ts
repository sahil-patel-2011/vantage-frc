// Subpath import keeps Node-only auth/db (pg) out of the client bundle —
// the "." barrel exports better-auth, which is fatal in "use client" files.
export {
  BOTH_MISSING_MESSAGE,
  LEGAL_DOC_VERSION,
  LEGAL_EFFECTIVE_DATE,
  PRIVACY_MISSING_MESSAGE,
  TERMS_MISSING_MESSAGE,
  assertLegalAccepted,
  legalAcceptanceRequired,
  recordLegalAcceptance,
} from "@vantage/core/legal";
export type { LegalAcceptanceFlags } from "@vantage/core/legal";

/** Client-safe gate: both boxes must be ticked before a consent form can submit. */
export function legalConsentComplete(input: { terms: boolean; privacy: boolean }): boolean {
  return input.terms === true && input.privacy === true;
}

/** Message naming the box(es) still unticked, or null when consent is complete. */
export function legalConsentMessage(input: { terms: boolean; privacy: boolean }): string | null {
  if (!input.terms && !input.privacy) {
    return "Agree to the Terms of Service and the Privacy Policy to continue.";
  }
  if (!input.terms) return "Agree to the Terms of Service to continue.";
  if (!input.privacy) return "Agree to the Privacy Policy to continue.";
  return null;
}
