import { createKms } from "@vantage/billing";

export type AiKeysEncryptionStatus =
  | { ok: true }
  | { ok: false; setupRequired: true; message: string };

/**
 * Probe envelope encryption without accepting secrets.
 * Production without AWS_KMS_KEY_ID refuses LocalKms — surface setup_required instead of crashing.
 */
export function aiKeysEncryptionStatus(): AiKeysEncryptionStatus {
  try {
    createKms();
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Key encryption is not configured on this deployment.";
    return {
      ok: false,
      setupRequired: true,
      message:
        message.includes("forbidden in production") || message.includes("KMS")
          ? "Envelope encryption needs AWS_KMS_KEY_ID (or a non-production local vault). API keys cannot be saved until KMS is configured."
          : message,
    };
  }
}
