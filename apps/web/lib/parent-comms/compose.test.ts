import { describe, expect, it } from "vitest";
import {
  buildTranslationPrompt,
  composeParentEmail,
  parseTranslationResponse,
  translationUnavailableNote,
} from "./compose";
import type { ParentDigest } from "./digest";

const digest: ParentDigest = {
  subject: "Robo Raiders: 2 upcoming events this week",
  text: "Tuesday\n  • 6:00 PM — Build session @ Shop",
  html: "<p><strong>Tuesday</strong></p><ul><li>Build session</li></ul>",
};

describe("buildTranslationPrompt", () => {
  it("carries the language tag, subject, and body", () => {
    const prompt = buildTranslationPrompt(digest, "es");
    expect(prompt).toContain('"es"');
    expect(prompt).toContain(`SUBJECT: ${digest.subject}`);
    expect(prompt).toContain("Build session");
  });
});

describe("parseTranslationResponse", () => {
  it("parses the SUBJECT protocol", () => {
    const parsed = parseTranslationResponse("SUBJECT: Hola equipo\n\nCuerpo traducido aquí.");
    expect(parsed).toEqual({ subject: "Hola equipo", body: "Cuerpo traducido aquí." });
  });
  it("rejects anything off-protocol so we never mislabel a body as translated", () => {
    expect(parseTranslationResponse("Here's your translation: hola")).toBeNull();
    expect(parseTranslationResponse("SUBJECT: only a subject")).toBeNull();
    expect(parseTranslationResponse("")).toBeNull();
  });
});

describe("composeParentEmail", () => {
  const base = {
    digest,
    language: "es",
    orgName: "Robo Raiders",
    unsubscribeUrl: "https://vantagefrc.com/api/parents/unsubscribe/tok_abc12345678901234",
  };

  it("uses the real translation and records the delivered language", () => {
    const email = composeParentEmail({
      ...base,
      translated: { subject: "Hola", body: "Cuerpo." },
    });
    expect(email.subject).toBe("Hola");
    expect(email.text).toContain("Cuerpo.");
    expect(email.text).toContain("Unsubscribe:");
    expect(email.html).toBeUndefined();
    expect(email.translatedTo).toBe("es");
  });

  it("ships English with an explicit note when translation is unavailable", () => {
    const email = composeParentEmail({ ...base, translated: null });
    expect(email.translatedTo).toBeNull();
    expect(email.text).toContain(translationUnavailableNote("es"));
    expect(email.text).toContain("Build session");
    expect(email.html).toContain("unavailable right now");
    expect(email.html).toContain("Unsubscribe");
  });

  it("adds no note for English contacts", () => {
    const email = composeParentEmail({ ...base, language: "en", translated: null });
    expect(email.text).not.toContain("unavailable");
    expect(email.translatedTo).toBeNull();
    expect(email.text).toContain("Unsubscribe:");
  });

  it("always carries the unsubscribe link in text and html", () => {
    const translated = composeParentEmail({ ...base, translated: { subject: "S", body: "B" } });
    const english = composeParentEmail({ ...base, language: "en", translated: null });
    for (const email of [translated, english]) {
      expect(email.text).toContain(base.unsubscribeUrl);
    }
    expect(english.html).toContain(base.unsubscribeUrl);
  });
});
