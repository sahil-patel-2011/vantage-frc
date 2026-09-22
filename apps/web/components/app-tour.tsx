"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  TOUR_STEPS,
  TOUR_STORAGE_KEY,
  availableSteps,
  placeCard,
  stepProgress,
  tourShouldYield,
  type Rect,
  type TourStep,
} from "../lib/tour/tour-steps";

/**
 * A five-stop tour of Home, shown once.
 *
 * It points at controls that already exist and says what they are for. It asks
 * for nothing, blocks nothing, and can be left at any point — Escape, the
 * Skip button, or clicking outside all end it, and it does not come back.
 *
 * Steps whose target is missing are dropped before the tour starts, so the
 * spotlight never lands on empty space. If nothing is on the page, the tour
 * simply does not run.
 */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === "done";
  } catch {
    // Private windows and locked-down school browsers throw here. Showing the
    // tour again is a smaller harm than crashing the page.
    return false;
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "done");
  } catch {
    // Nothing to do: the tour just may appear again on the next visit.
  }
}

function visibleTourTarget(name: string): HTMLElement | null {
  const nodes = document.querySelectorAll(`[data-tour="${name}"]`);
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    const box = node.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return node;
  }
  return null;
}

function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function openDialogLabels(): (string | null)[] {
  return [...document.querySelectorAll('[role="dialog"]')]
    .filter((node): node is HTMLElement => {
      if (!(node instanceof HTMLElement)) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    })
    .map((node) => node.getAttribute("aria-label"));
}

/** Home's tour. Onboarding and sign-in are a form, and a full-screen scrim there swallows the first tap. */
function tourWaits(pathname: string): boolean {
  return (
    pathname === "/onboarding" ||
    pathname.startsWith("/onboarding/") ||
    pathname === "/claim" ||
    pathname === "/signin" ||
    pathname === "/sign-in" ||
    pathname === "/invite"
  );
}

export function AppTour() {
  const pathname = usePathname();
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Rect | null>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number; side: string } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);

  const finish = useCallback(() => {
    markDismissed();
    setSteps(null);
  }, []);

  // Decide once, after paint, so the targets have actually rendered.
  useEffect(() => {
    if (readDismissed()) return;
    if (tourWaits(pathname)) return;
    // Poll rather than fire once: the consent banner is the other thing that
    // wants an answer on a first visit, and both appearing together meant a
    // brand new user met two overlapping dialogs before seeing a single word
    // of their own data. The tour waits for the banner to be gone.
    const consentShowing = () =>
      document.querySelector(".consent-banner") != null;

    let elapsed = 0;
    const id = window.setInterval(() => {
      elapsed += 400;
      if (consentShowing() || tourShouldYield(openDialogLabels())) {
        // Give up after a while rather than waiting forever on someone who
        // never answers the cookie card: the tour simply does not run this
        // visit. A dialog they opened on purpose is different — keep waiting,
        // because starting the scrim on top of it steals the next click.
        if (consentShowing() && elapsed > 60_000) window.clearInterval(id);
        return;
      }
      window.clearInterval(id);
      const present = (name: string) => visibleTourTarget(name) != null;
      const usable = availableSteps(TOUR_STEPS, present);
      // One lonely step is not a tour worth interrupting anyone for.
      if (usable.length >= 2) setSteps(usable);
    }, 400);
    return () => window.clearInterval(id);
  }, [pathname]);

  const step = steps?.[index] ?? null;

  // A dialog opened after the tour started (set active event, add a teammate)
  // has to receive clicks. Hide the scrim until that dialog closes; do not
  // mark the tour finished, because the person did not dismiss it.
  useEffect(() => {
    if (!steps) return;
    const watch = () => setPaused(tourShouldYield(openDialogLabels()));
    watch();
    const id = window.setInterval(watch, 200);
    return () => window.clearInterval(id);
  }, [steps]);

  // Measure the target and place the card. Re-runs on resize and scroll so the
  // spotlight cannot drift off the thing it is pointing at.
  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => {
      const element = visibleTourTarget(step.target);
      if (!element) {
        setTarget(null);
        return;
      }
      const rect = rectOf(element);
      setTarget(rect);
      const card = cardRef.current?.getBoundingClientRect();
      setPlacement(
        placeCard({
          target: rect,
          card: { width: card?.width || 320, height: card?.height || 160 },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          prefer: step.prefer,
        }),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, index]);

  useEffect(() => {
    if (!step) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key === "ArrowRight") setIndex((i) => Math.min(i + 1, (steps?.length ?? 1) - 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, steps, finish]);

  if (!steps || !step || paused) return null;
  const isLast = index === steps.length - 1;

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Tour of Vantage">
      {/* Clicking the dimmed area leaves the tour — the standard escape hatch. */}
      <button className="tour-scrim" type="button" aria-label="Close tour" onClick={finish} />
      {target ? (
        <span
          className="tour-spotlight"
          aria-hidden="true"
          style={{
            top: target.top - 6,
            left: target.left - 6,
            width: target.width + 12,
            height: target.height + 12,
          }}
        />
      ) : null}
      <div
        ref={cardRef}
        className={`tour-card tour-card-${placement?.side ?? "bottom"}`}
        style={{ top: placement?.top ?? 24, left: placement?.left ?? 24 }}
      >
        <span className="tour-progress">{stepProgress(index, steps.length)}</span>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={finish}>
            Skip
          </button>
          <div className="tour-move">
            {index > 0 ? (
              <button type="button" onClick={() => setIndex((i) => i - 1)}>
                Back
              </button>
            ) : null}
            <button
              type="button"
              className="tour-next"
              onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
