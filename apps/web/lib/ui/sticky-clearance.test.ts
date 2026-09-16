import { describe, expect, it } from "vitest";
import {
  STICKY_TOP_GAP,
  needsRevealBelowStickyChrome,
  scrollTopBelowStickyChrome,
  stickyTopChromeHeight,
} from "./sticky-clearance";

describe("sticky top chrome height", () => {
  it("is zero when no bar is mounted", () => {
    expect(stickyTopChromeHeight({ querySelector: () => null })).toBe(0);
  });

  it("reads the mounted bar instead of assuming a constant", () => {
    const doc = {
      querySelector: () => ({ getBoundingClientRect: () => ({ height: 52 }) }) as unknown as Element,
    };
    expect(stickyTopChromeHeight(doc)).toBe(52);
  });

  it("ignores a collapsed measurement rather than scrolling by NaN", () => {
    const doc = {
      querySelector: () =>
        ({ getBoundingClientRect: () => ({ height: Number.NaN }) }) as unknown as Element,
    };
    expect(stickyTopChromeHeight(doc)).toBe(0);
  });
});

describe("needs reveal below sticky chrome", () => {
  const viewportHeight = 844;

  it("counts a row parked behind the bar as hidden", () => {
    expect(needsRevealBelowStickyChrome({ elementTop: 8, chromeHeight: 56, viewportHeight })).toBe(
      true,
    );
  });

  it("leaves a board that already clears the bar alone", () => {
    expect(
      needsRevealBelowStickyChrome({
        elementTop: 56 + STICKY_TOP_GAP + 1,
        chromeHeight: 56,
        viewportHeight,
      }),
    ).toBe(false);
  });

  it("treats the gap itself as too close to tap", () => {
    expect(needsRevealBelowStickyChrome({ elementTop: 60, chromeHeight: 56, viewportHeight })).toBe(
      true,
    );
  });

  it("counts a board pushed below the fold as unreachable", () => {
    expect(
      needsRevealBelowStickyChrome({ elementTop: 772, chromeHeight: 52, viewportHeight }),
    ).toBe(true);
  });

  it("accepts a board with a usable strip already on screen", () => {
    expect(
      needsRevealBelowStickyChrome({ elementTop: 500, chromeHeight: 52, viewportHeight }),
    ).toBe(false);
  });
});

describe("scroll top below sticky chrome", () => {
  it("lands the element under the bar plus the gap", () => {
    expect(scrollTopBelowStickyChrome({ elementTop: 0, scrollY: 400, chromeHeight: 56 })).toBe(
      400 - 56 - STICKY_TOP_GAP,
    );
  });

  it("never scrolls above the top of the document", () => {
    expect(scrollTopBelowStickyChrome({ elementTop: 10, scrollY: 0, chromeHeight: 56 })).toBe(0);
  });

  it("keeps an element already below the bar in place", () => {
    const elementTop = 200;
    const scrollY = 100;
    expect(scrollTopBelowStickyChrome({ elementTop, scrollY, chromeHeight: 56 })).toBe(
      scrollY + elementTop - 56 - STICKY_TOP_GAP,
    );
  });
});
