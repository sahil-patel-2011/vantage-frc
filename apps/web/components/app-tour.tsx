"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  TOUR_DIALOG_LABEL,
  TOUR_HOME_READY_TARGET,
  TOUR_STEPS,
  TOUR_STORAGE_KEY,
  availableSteps,
  placeCard,
  stepProgress,
  tourIsWorthShowing,
  tourShouldYield,
  type Rect,
  type TourStep,
} from "../lib/tour/tour-steps";
import {
  resolveTourStart,
  tourStartMode,
  withoutReplayParam,
  type TourAccount,
  type TourStartMode,
} from "../lib/tour/tour-start";
import { requestMe } from "../lib/nav/me-request";
import { URL_CHANGE_EVENT } from "../lib/nav/url-change";
import "./app-tour.css";

/**
 * A short tour of Home: what Vantage is for, then the parts a new person will use, ending at
 * the feedback button.
 *
 * It points at controls that already exist and says what they are for. It asks for nothing,
 * blocks nothing, and can be left at any point — Escape, the Skip button, or clicking outside
 * all end it, and it does not come back.
 *
 * Two ways in, and only two (lib/tour/tour-start.ts has the rules and the tests):
 *   - First run. Once per account, on any device. "Once" is counted when it appears, not when
 *     it is dismissed: the server claim (POST /api/account/tour) is atomic and is the only
 *     thing that can start it, and it only succeeds for an onboarded account in its first two
 *     weeks. A new browser or the desktop app does not replay it to someone who has seen it.
 *   - On request. "Take the tour again" opens Home with ?tour=replay. That starts it whatever
 *     the once-only state, never calls the claim, and removes the parameter once it has started.
 *
 * Steps whose target is missing are dropped before the tour starts, so the spotlight never lands
 * on empty space. If there is hardly anything on the page to point at, the tour simply does not run.
 */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === "done";
  } catch {
    // If the once-only marker cannot be read, keep the working app unobstructed.
    return true;
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "done");
  } catch {
    // The account claim remains authoritative if browser storage is unavailable.
  }
}

function visibleTourTarget(name: string): HTMLElement | null {
  const nodes = document.querySelectorAll(`[data-tour="${name}"]`);
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    const box = node.getBoundingClientRect();
    // On screen and actually shown: the left menu is hidden by default now (slid off to the
    // left with visibility hidden), and a highlight around an off-screen button is a dead tour.
    const onScreen = box.right > 0 && box.left < window.innerWidth && box.bottom > 0 && box.top < window.innerHeight;
    if (box.width > 0 && box.height > 0 && onScreen && getComputedStyle(node).visibility !== "hidden") return node;
  }
  return null;
}

function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

/** The spotlight follows the shape of what it frames: a round button gets a round ring. */
function spotRadius(element: Element): string {
  const radius = getComputedStyle(element).borderTopLeftRadius;
  if (radius.endsWith("%")) return Number.parseFloat(radius) >= 50 ? "50%" : "14px";
  const px = Number.parseFloat(radius);
  return `${Number.isFinite(px) ? Math.min(Math.max(px + 6, 14), 999) : 14}px`;
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

/** The card text changes after this long, so the old words fade out before the new ones fade in. */
function fadeMs(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--dur-tint").trim();
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return 0;
    return raw.endsWith("ms") ? value : raw.endsWith("s") ? value * 1000 : 0;
  } catch {
    return 0;
  }
}

/** Ask the server for the one first-run tour this account gets. Anything but a clear yes is a no. */
async function claimFirstTour(): Promise<boolean> {
  const response = await fetch("/api/account/tour", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { start?: unknown };
  return result.start === true;
}

/** After the tour has started, so a reload or a copied link does not start it again. */
function stripReplayParam() {
  const next = withoutReplayParam(window.location.href);
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history.replaceState(window.history.state, "", next);
  // The app frame reads the address on this event; without it a team-switch link built from the
  // old address would carry the parameter into another team's Home.
  window.dispatchEvent(new Event(URL_CHANGE_EVENT));
}

/**
 * Pages that are themselves a guided flow. A tour card pointing at the search
 * box on top of "Step 1 of 3 · You" is two teachers talking at once, and a
 * full-screen scrim there swallows the first tap; the tour waits until the
 * person reaches the app proper.
 */
export function tourBlockedOn(pathname: string | null): boolean {
  if (!pathname) return false;
  return ["/onboarding", "/invite", "/join-team", "/signin", "/sign-in", "/claim"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Home paints its cards after the shell; give them this long before going with what is there. */
const HOME_READY_WAIT_MS = 4000;
const POLL_MS = 400;

export function AppTour() {
  const pathname = usePathname();
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  // The step whose words are on the card. It trails `index` by one fade, so the words cross-fade
  // while the spotlight and the card glide to the next target.
  const [shownIndex, setShownIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [target, setTarget] = useState<Rect | null>(null);
  const [radius, setRadius] = useState("14px");
  const [snap, setSnap] = useState(false);
  const [placement, setPlacement] = useState<{ top: number; left: number; side: string } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const stepsRef = useRef<TourStep[] | null>(null);
  const [paused, setPaused] = useState(false);
  // `?tour=replay` can arrive without the pathname changing (Take the tour again, from Home).
  const [addressTick, setAddressTick] = useState(0);

  stepsRef.current = steps;

  const finish = useCallback(() => {
    markDismissed();
    setSteps(null);
  }, []);

  useEffect(() => {
    const bump = () => setAddressTick((tick) => tick + 1);
    window.addEventListener("popstate", bump);
    window.addEventListener(URL_CHANGE_EVENT, bump);
    return () => {
      window.removeEventListener("popstate", bump);
      window.removeEventListener(URL_CHANGE_EVENT, bump);
    };
  }, []);

  useEffect(() => { if (pathname !== "/dashboard") setSteps(null); }, [pathname]);

  // Decide once, after paint, so the targets have actually rendered.
  useEffect(() => {
    if (tourBlockedOn(pathname)) return;
    // Home only: on a working page (scouting, event day) the scrim covered the task at hand.
    if (pathname !== "/dashboard") return;
    if (stepsRef.current) return;

    const search = window.location.search;
    const doneInBrowser = readDismissed();
    let cancelled = false;
    let id: number | undefined;

    // Poll rather than fire once: the consent banner is the other thing that
    // wants an answer on a first visit, and both appearing together meant a
    // brand new user met two overlapping dialogs before seeing a single word
    // of their own data. The tour waits for the banner to be gone.
    const consentShowing = () => document.querySelector(".consent-banner") != null;
    const begin = (mode: TourStartMode) => {
      let elapsed = 0;
      let waitedForHome = 0;
      id = window.setInterval(() => {
        elapsed += POLL_MS;
        if (consentShowing() || tourShouldYield(openDialogLabels())) {
          // Give up after a while rather than waiting forever on someone who
          // never answers the cookie card: the first-run tour simply does not run
          // this visit. A dialog they opened on purpose is different — keep waiting,
          // because starting the scrim on top of it steals the next click. Someone who
          // asked for the tour is still there and still wants it.
          if (mode === "first-run" && consentShowing() && elapsed > 60_000) window.clearInterval(id);
          return;
        }
        const present = (name: string) => visibleTourTarget(name) != null;
        if (!present(TOUR_HOME_READY_TARGET) && (waitedForHome += POLL_MS) <= HOME_READY_WAIT_MS) return;
        window.clearInterval(id);
        const usable = availableSteps(TOUR_STEPS, present);
        // A welcome and one thing to point at is not a tour worth interrupting anyone for.
        if (!tourIsWorthShowing(usable)) {
          if (mode === "replay") stripReplayParam();
          return;
        }
        // The server claim is atomic and account-scoped. If unavailable, defer the automatic
        // tour rather than risk replaying it on another browser. A replay never asks.
        void resolveTourStart(mode, claimFirstTour).then((start) => {
          if (cancelled || !start) return;
          markDismissed();
          if (mode === "replay") stripReplayParam();
          setIndex(0);
          setShownIndex(0);
          setLeaving(false);
          setSteps(usable);
        });
      }, POLL_MS);
    };

    if (tourStartMode({ search, doneInBrowser, account: null }) === "replay") {
      begin("replay");
    } else if (!doneInBrowser) {
      void requestMe().then((me) => {
        if (cancelled) return;
        const account = me.ok ? (me.data as TourAccount | null) : null;
        if (tourStartMode({ search, doneInBrowser, account }) === "first-run") begin("first-run");
      });
    }
    return () => {
      cancelled = true;
      if (id !== undefined) window.clearInterval(id);
    };
    // Re-checked on navigation, so leaving onboarding for Home starts it there, and when the
    // address changes in place (Take the tour again, from Home).
  }, [pathname, addressTick]);

  const step = steps?.[index] ?? null;
  const shown = steps?.[shownIndex] ?? step;

  // The words follow the spotlight by one fade.
  useEffect(() => {
    if (!steps || index === shownIndex) return;
    const ms = fadeMs();
    if (ms <= 0) {
      setShownIndex(index);
      return;
    }
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setShownIndex(index);
      setLeaving(false);
    }, ms);
    return () => window.clearTimeout(timer);
  }, [index, shownIndex, steps]);

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

  // Tell the page which stop this is. The corner feedback button hides while the tour is up,
  // except on the stop that points at it. Declared before the measuring effect on purpose: the
  // button must already be visible when that stop measures it.
  useLayoutEffect(() => {
    if (!step) return;
    document.body.dataset.tourStep = step.id;
    return () => {
      delete document.body.dataset.tourStep;
    };
  }, [step]);

  // Measure the target and place the card. Re-runs on resize and scroll so the
  // spotlight cannot drift off the thing it is pointing at; those updates snap
  // instead of gliding, so the ring does not trail the page as it scrolls.
  useLayoutEffect(() => {
    if (!step) return;
    const measure = (snapNow: boolean) => {
      const element = step.target ? visibleTourTarget(step.target) : null;
      const rect = element ? rectOf(element) : null;
      setSnap(snapNow);
      setTarget(rect);
      if (element) setRadius(spotRadius(element));
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
    measure(false);
    const onChange = () => measure(true);
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [step, shownIndex]);

  // A dialog takes focus when it opens. Next is where a keyboard user wants to be.
  const hasTour = steps != null && !paused;
  useEffect(() => {
    if (hasTour) nextRef.current?.focus({ preventScroll: true });
  }, [hasTour]);

  useEffect(() => {
    if (!step) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key === "ArrowRight") setIndex((i) => Math.min(i + 1, (steps?.length ?? 1) - 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
      if (event.key === "Tab") {
        // Keep Tab inside the card: the page behind the scrim is not reachable while the tour is up.
        const controls = [...(cardRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
        if (controls.length === 0) return;
        const first = controls[0]!;
        const last = controls[controls.length - 1]!;
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !cardRef.current?.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !cardRef.current?.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, steps, finish]);

  if (!steps || !step || !shown || paused) return null;
  const isLast = index === steps.length - 1;
  const welcome = index === 0 && step.target === null;
  // With nothing to frame, the spotlight is a point at the centre whose shadow dims the page;
  // it opens out to the first target, so the move from the welcome to the tour glides too.
  const spot = target
    ? { top: target.top - 6, left: target.left - 6, width: target.width + 12, height: target.height + 12 }
    : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label={TOUR_DIALOG_LABEL} data-snap={snap || undefined}>
      {/* Clicking the dimmed area leaves the tour — the standard escape hatch. */}
      <button className="tour-scrim" type="button" aria-label="Close tour" onClick={finish} />
      <span
        className="tour-spotlight"
        aria-hidden="true"
        data-empty={!target || undefined}
        style={{ ...spot, borderRadius: target ? radius : "50%" }}
      />
      <div
        ref={cardRef}
        className={`tour-card tour-card-${placement?.side ?? "center"}`}
        style={{ top: placement?.top ?? 24, left: placement?.left ?? 24 }}
      >
        <div className="tour-card-body" data-leaving={leaving || undefined} aria-live="polite">
          <span className="tour-progress">{stepProgress(shownIndex, steps.length)}</span>
          <h2>{shown.title}</h2>
          <p>{shown.body}</p>
        </div>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={finish}>
            Skip
          </button>
          <div className="tour-move">
            {index > 0 ? (
              <button type="button" onClick={() => setIndex((i) => Math.max(i - 1, 0))}>
                Back
              </button>
            ) : null}
            <button
              ref={nextRef}
              type="button"
              className="tour-next"
              onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
            >
              {isLast ? "Done" : welcome ? "Show me around" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
