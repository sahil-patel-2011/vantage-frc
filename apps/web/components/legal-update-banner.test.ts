import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  UX-10: on a phone the Terms/Privacy notice and the event bar took most of the first screen.
  Closed, the notice is now one line and a Review button there; opened, it is the full notice
  with the same two consents as before.
*/

const src = readFileSync(join(__dirname, "legal-update-banner.tsx"), "utf8");
const css = readFileSync(join(__dirname, "legal-update-banner.css"), "utf8");
const phone = css.slice(css.indexOf("@media (max-width: 640px)"));

describe("legal update banner on a phone", () => {
  it("is one line and a 44px Review button until it is opened", () => {
    expect(src).toMatch(/data-open=\{open \? "true" : "false"\}/);
    expect(src).toMatch(/<strong className="legal-update-short">Terms and Privacy updated<\/strong>/);
    expect(src).toMatch(/<span className="legal-update-short">Review<\/span>/);
    expect(phone).toMatch(/\.legal-update\[data-open="false"\] \.legal-update-full \{ display: none; \}/);
    expect(phone).toMatch(/\.legal-update\[data-open="false"\] \.legal-update-short \{ display: inline; \}/);
    expect(phone).toMatch(/white-space: nowrap;/);
    expect(phone).toMatch(/\.legal-update\[data-open="false"\] > \.app-button \{ flex: none; min-height: 44px; \}/);
  });

  it("never hides the notice itself, only shortens it while closed", () => {
    expect(phone).not.toMatch(/\.legal-update \{[^}]*display: none/);
    expect(phone).not.toMatch(/\[data-open="true"\]/);
    // Outside the phone rule the short wording never shows.
    expect(css.slice(0, css.indexOf("@media"))).toMatch(/\.legal-update \.legal-update-short \{ display: none; \}/);
  });

  it("keeps the full notice, the short-version link and the accept flow", () => {
    expect(src).toMatch(/We rewrote our Terms and Privacy Policy/);
    expect(src).toMatch(/href="\/privacy#summary"/);
    expect(src).toMatch(/<LegalAgreementCheckbox/);
    expect(src).toMatch(/Tick both boxes to accept\./);
    expect(src).toMatch(/JSON\.stringify\(\{ termsAccepted: true, privacyAccepted: true \}\)/);
  });
});
