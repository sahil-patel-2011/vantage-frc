import { isEnglish } from "./contacts";
import type { ParentDigest } from "./digest";

/**
 * Pure composition of the outgoing parent email: translation prompt/response
 * handling, the translation-unavailable note, and the mandatory unsubscribe
 * footer. Honesty rules live here:
 *   - a body is labeled translated ONLY when a real translation happened;
 *   - when translation is unavailable the English body ships with an explicit
 *     one-line note — never silently, never mislabeled.
 */

export type TranslatedDigest = { subject: string; body: string };

export function buildTranslationPrompt(digest: ParentDigest, language: string): string {
  return [
    `Translate this parent update email into the language with BCP-47 tag "${language}".`,
    "Keep dates, times, numbers, team names, and URLs exactly as written.",
    'Reply with the translated subject on the first line prefixed "SUBJECT: ", then a blank line, then the translated body. No other commentary.',
    "",
    `SUBJECT: ${digest.subject}`,
    "",
    digest.text,
  ].join("\n");
}

/** Strict parse of the translation protocol; anything else returns null. */
export function parseTranslationResponse(raw: string): TranslatedDigest | null {
  const text = raw.trim();
  if (!text) return null;
  const newline = text.indexOf("\n");
  const firstLine = (newline < 0 ? text : text.slice(0, newline)).trim();
  const match = /^SUBJECT:\s*(.+)$/i.exec(firstLine);
  if (!match) return null;
  const subject = (match[1] ?? "").trim();
  const body = newline < 0 ? "" : text.slice(newline + 1).trim();
  if (!subject || !body) return null;
  return { subject, body };
}

export function translationUnavailableNote(language: string): string {
  return `(Translation to "${language}" is unavailable right now — this update is in English.)`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textFooter(orgName: string, unsubscribeUrl: string): string {
  return [
    "—",
    `You are receiving this because ${orgName} added you as a parent contact on Vantage.`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
}

function htmlFooter(orgName: string, unsubscribeUrl: string): string {
  return (
    `<hr style="border:none;border-top:1px solid #ccc;margin:16px 0" />` +
    `<p style="font-size:12px;color:#666">You are receiving this because ${escapeHtml(orgName)} added you as a parent contact on Vantage. ` +
    `<a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`
  );
}

export type ComposedParentEmail = {
  subject: string;
  text: string;
  html?: string;
  /** The language ACTUALLY delivered, or null for the English original. */
  translatedTo: string | null;
};

/**
 * Assemble the final email for one contact. `translated` must be a real
 * model translation (or null); this function never fabricates one.
 */
export function composeParentEmail(input: {
  digest: ParentDigest;
  translated: TranslatedDigest | null;
  language: string;
  orgName: string;
  unsubscribeUrl: string;
}): ComposedParentEmail {
  const footer = textFooter(input.orgName, input.unsubscribeUrl);

  if (input.translated) {
    return {
      subject: input.translated.subject,
      text: `${input.translated.body.trim()}\n\n${footer}`,
      // Translated sends are text-only: we never pair a translated text body
      // with an English HTML body.
      translatedTo: input.language,
    };
  }

  const needsNote = !isEnglish(input.language);
  const note = needsNote ? translationUnavailableNote(input.language) : null;
  const text = `${note ? `${note}\n\n` : ""}${input.digest.text.trim()}\n\n${footer}`;
  const html =
    `${note ? `<p style="font-size:12px;color:#666">${escapeHtml(note)}</p>\n` : ""}` +
    `${input.digest.html}\n${htmlFooter(input.orgName, input.unsubscribeUrl)}`;
  return { subject: input.digest.subject, text, html, translatedTo: null };
}
