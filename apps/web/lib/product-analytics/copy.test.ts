import { describe, expect, it } from "vitest";
import { ANALYTICS_BANNER_COPY, FORBIDDEN_BANNER_WORDS } from "./copy";

/**
 * The banner's words are pinned.
 *
 * Consent copy decays in one direction: towards whatever gets the most yeses.
 * These assertions are the ratchet against that. Changing them should feel like
 * changing a policy, because it is one.
 */
describe("consent banner copy", () => {
  const spoken = [
    ANALYTICS_BANNER_COPY.title,
    ANALYTICS_BANNER_COPY.lead,
    ANALYTICS_BANNER_COPY.detail,
    ANALYTICS_BANNER_COPY.reassurance,
    ANALYTICS_BANNER_COPY.acceptLabel,
    ANALYTICS_BANNER_COPY.declineLabel,
    ANALYTICS_BANNER_COPY.detailsLabel,
  ];
  const body = spoken.join(" ");

  it("has non-empty text for every slot the banner renders", () => {
    for (const [key, value] of Object.entries(ANALYTICS_BANNER_COPY)) {
      expect(String(value).trim().length, `${key} must not be blank`).toBeGreaterThan(0);
    }
  });

  it("leads by saying it is NOT anonymous", () => {
    expect(ANALYTICS_BANNER_COPY.lead).toContain("This is not anonymous to us.");
  });

  it("never uses the comfortable words", () => {
    for (const word of FORBIDDEN_BANNER_WORDS) {
      expect(body.toLowerCase(), `banner must not say "${word}"`).not.toContain(word);
    }
  });

  it("names what is recorded, in the banner itself and not only behind a link", () => {
    expect(ANALYTICS_BANNER_COPY.lead).toMatch(/which pages and features/i);
    expect(ANALYTICS_BANNER_COPY.lead).toMatch(/your account/i);
    expect(ANALYTICS_BANNER_COPY.lead).toMatch(/your team/i);
    expect(ANALYTICS_BANNER_COPY.detail).toMatch(/phone, tablet, or computer/i);
  });

  it("denies location, ad networks, cross-site tracking, replay, and content", () => {
    const detail = ANALYTICS_BANNER_COPY.detail.toLowerCase();
    expect(detail).toContain("no location");
    expect(detail).toContain("no ad networks");
    expect(detail).toContain("no tracking you across other websites");
    expect(detail).toContain("no recording of your screen");
    expect(detail).toContain("never the things you type");
  });

  it("promises that declining costs the user nothing", () => {
    expect(ANALYTICS_BANNER_COPY.reassurance).toMatch(/still works exactly the same/i);
    expect(ANALYTICS_BANNER_COPY.reassurance).toMatch(/change your answer at any time/i);
  });

  it("gives the decline a real, plain label rather than a dismissal", () => {
    const decline = ANALYTICS_BANNER_COPY.declineLabel.toLowerCase();
    expect(decline).toBe("only necessary cookies");
    // "Not now" / "Maybe later" imply we will ask again. We do not.
    expect(decline).not.toMatch(/not now|later|skip|dismiss/);
  });

  it("points at the analytics section of the privacy policy", () => {
    expect(ANALYTICS_BANNER_COPY.detailsHref).toBe("/privacy#analytics");
  });

  it("keeps both buttons short enough to fit a 360px screen", () => {
    expect(ANALYTICS_BANNER_COPY.acceptLabel.length).toBeLessThanOrEqual(28);
    expect(ANALYTICS_BANNER_COPY.declineLabel.length).toBeLessThanOrEqual(28);
  });

  it("labels the region for screen readers", () => {
    expect(ANALYTICS_BANNER_COPY.ariaLabel).toBe("Product analytics choice");
  });
});
