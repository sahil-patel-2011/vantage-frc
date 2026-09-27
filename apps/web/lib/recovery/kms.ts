import { EnvKeyKmsService } from "@vantage/billing";
/** Separately held operator key. It is never written into Google resources. */
export function createRecoveryKms() {
  const value = process.env.RECOVERY_ENCRYPTION_KEY;
  if (!value || value.includes("[SENSITIVE]") || Buffer.from(value, "base64").length !== 32) throw new Error("The separately held recovery encryption key is not configured.");
  return new EnvKeyKmsService(value);
}
