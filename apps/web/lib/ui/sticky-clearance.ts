/**
 * The product shell's top bar is `position:fixed`, so it is outside the scroll
 * flow: aligning an element to the viewport top leaves its first rows behind
 * the bar. On Home that hid the board's top row during tap-to-place, and a
 * tap there hit the bar instead of the slot under it.
 *
 * `scroll-margin-top` covers CSS-driven `scrollIntoView`, but not a scroll we
 * compute ourselves and not Chrome DevTools' scroll-into-view, so the offset
 * lives here as one measured number both paths use.
 */
export const STICKY_TOP_GAP = 12;

/** Height of the chrome pinned to the top of the viewport, in CSS pixels. */
export function stickyTopChromeHeight(doc: Pick<Document, "querySelector">): number {
  const bar = doc.querySelector(".soft-topbar");
  if (!bar) return 0;
  const height = bar.getBoundingClientRect().height;
  return Number.isFinite(height) && height > 0 ? height : 0;
}

export function scrollTopBelowStickyChrome(input: {
  elementTop: number;
  scrollY: number;
  chromeHeight: number;
  gap?: number;
}): number {
  const gap = input.gap ?? STICKY_TOP_GAP;
  return Math.max(0, input.scrollY + input.elementTop - input.chromeHeight - gap);
}

/** How much of the element must be on screen before a scroll is pointless. */
export const STICKY_MIN_VISIBLE = 96;

/**
 * True when the element cannot be acted on where it is: either its top edge is
 * behind the pinned chrome, or it starts so far down that nothing useful is on
 * screen. On a phone the widget palette pushed Home's board ~770px down, so
 * "tap a slot on the board" named something below the fold.
 */
export function needsRevealBelowStickyChrome(input: {
  elementTop: number;
  chromeHeight: number;
  viewportHeight: number;
  gap?: number;
  minVisible?: number;
}): boolean {
  const gap = input.gap ?? STICKY_TOP_GAP;
  const minVisible = input.minVisible ?? STICKY_MIN_VISIBLE;
  if (input.elementTop < input.chromeHeight + gap) return true;
  return input.elementTop > input.viewportHeight - minVisible;
}

/**
 * Bring `element` to the top of the readable area, just under the pinned
 * chrome. A no-op when it is already usable where it is, so picking a widget
 * does not yank a board the student is already looking at.
 */
export function revealBelowStickyChrome(element: HTMLElement | null): void {
  if (!element || typeof window === "undefined") return;
  const chromeHeight = stickyTopChromeHeight(element.ownerDocument);
  const elementTop = element.getBoundingClientRect().top;
  const viewportHeight = window.innerHeight;
  if (!needsRevealBelowStickyChrome({ elementTop, chromeHeight, viewportHeight })) return;
  window.scrollTo({
    top: scrollTopBelowStickyChrome({
      elementTop,
      scrollY: window.scrollY,
      chromeHeight,
    }),
    behavior: "auto",
  });
}
