/**
 * Parent contact normalisation + validation. Pure — mirrored by the CHECK
 * constraints in migration 0471 so a value that passes here also inserts.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** BCP-47-ish: primary subtag + up to two extra subtags, max 12 chars total. */
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  return EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * Keep an optional leading + and digits; tolerate common punctuation.
 * Returns null for absent input, throws nothing — invalid shapes return
 * undefined so callers can distinguish "not provided" from "not a phone".
 */
export function normalizePhone(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[\s().-]/g, "");
  if (!/^\+?\d{7,15}$/.test(cleaned)) return undefined;
  return cleaned;
}

/** Normalise a language tag ('EN' -> 'en', 'pt-br' -> 'pt-BR' left as typed case-wise apart from the primary). */
export function normalizeLanguage(value: unknown): string | null {
  if (value == null || value === "") return "en";
  if (typeof value !== "string") return null;
  const tag = value.trim();
  if (!tag || tag.length > 12 || !LANGUAGE_PATTERN.test(tag)) return null;
  const [primary, ...rest] = tag.split("-");
  return [(primary ?? "").toLowerCase(), ...rest].join("-");
}

export function isEnglish(language: string): boolean {
  return language.toLowerCase() === "en" || language.toLowerCase().startsWith("en-");
}

export function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 120) return null;
  return name;
}

export function normalizeStudentLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

export type ParentContactInput = {
  name: string;
  email: string;
  phone: string | null;
  preferredLanguage: string;
  studentLabel: string;
};

export type ContactValidation =
  | { ok: true; contact: ParentContactInput }
  | { ok: false; error: string };

/** Validate a full add/edit payload into an insertable shape, or a human error. */
export function validateContactInput(raw: {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  preferredLanguage?: unknown;
  studentLabel?: unknown;
}): ContactValidation {
  const name = normalizeName(raw.name);
  if (!name) return { ok: false, error: "Parent name is required (max 120 characters)." };
  const email = normalizeEmail(raw.email);
  if (!email) return { ok: false, error: "A valid parent email address is required." };
  const phone = normalizePhone(raw.phone);
  if (phone === undefined) {
    return { ok: false, error: "Phone must be 7–15 digits (an optional leading + is fine)." };
  }
  const preferredLanguage = normalizeLanguage(raw.preferredLanguage);
  if (!preferredLanguage) {
    return { ok: false, error: "Preferred language must be a short tag like en, es, or zh-Hans." };
  }
  return {
    ok: true,
    contact: {
      name,
      email,
      phone,
      preferredLanguage,
      studentLabel: normalizeStudentLabel(raw.studentLabel),
    },
  };
}
