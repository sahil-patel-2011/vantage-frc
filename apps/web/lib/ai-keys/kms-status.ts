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
          ? "Key encryption is not configured: set VANTAGE_KMS_MASTER_KEY (base64 of 32 random bytes, openssl rand -base64 32) or AWS_KMS_KEY_ID. Keys and connector sign-ins cannot be saved until then."
          : message,
    };
  }
}
