import { createHash, randomInt, timingSafeEqual } from "node:crypto";

const E164 = /^\+[1-9][0-9]{7,14}$/;
const EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function normalizeRecoveryEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  if (!trimmed) return null;
  if (!EMAIL.test(trimmed) || trimmed.length > 254) {
    throw new Error("Enter a valid recovery email.");
  }
  return trimmed;
}

/** Accepts E.164 or a 10-digit US number. */
export function normalizePhoneE164(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  let candidate = digits;
  if (/^\d{10}$/.test(digits)) candidate = `+1${digits}`;
  else if (/^1\d{10}$/.test(digits)) candidate = `+${digits}`;
  if (!E164.test(candidate)) {
    throw new Error("Enter a phone number with country code, like +15551234567.");
  }
  return candidate;
}

export function phoneOtpSetupStatus(): { configured: boolean; message: string } {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (sid && token && from) {
    return { configured: true, message: "We'll text a code to this number to confirm it." };
  }
  return {
    configured: false,
    message: "Phone codes need text messaging set up on this team. Email sign-in still works.",
  };
}

export function hashPhoneOtp(userId: string, phone: string, code: string): string {
  return createHash("sha256").update(`${userId}:${phone}:${code}`).digest("hex");
}

export function newPhoneOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function phoneOtpMatches(storedHash: string, candidateHash: string): boolean {
  const a = Buffer.from(storedHash);
  const b = Buffer.from(candidateHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function sendPhoneOtpSms(phoneE164: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const setup = phoneOtpSetupStatus();
  if (!setup.configured) return { ok: false, error: setup.message };
  const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
  const token = process.env.TWILIO_AUTH_TOKEN!.trim();
  const from = process.env.TWILIO_FROM_NUMBER!.trim();
  const body = new URLSearchParams({
    To: phoneE164,
    From: from,
    Body: `Your Vantage phone verification code is ${code}. It expires in 10 minutes.`,
  });
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) return { ok: false, error: `SMS provider returned ${response.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "SMS send failed" };
  }
}
