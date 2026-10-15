"use client";
import { Button } from "../../components/ui";
import { ChoiceField } from "../../components/ui/choice-field";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_APPEARANCE_PREFS,
  appearanceEquals,
  parseAppearancePrefs,
  type AppearancePrefs,
  type DensityPreference,
  type MotionPreference,
  type ClarityPreference,
} from "../../lib/branding/appearance";
import { applyBranding, broadcastAppearance } from "../../lib/branding/appearance-runtime";
import { type OrgBrandingView } from "../../lib/branding/branding";
import {
  BAR_SLOTS,
  PINS_CHANGED_EVENT,
  PINS_EDIT_EVENT,
  defaultPinHrefs,
  resolvePins,
  resolveStoredPins,
} from "../../lib/nav/pins";
import { Icon } from "../../components/icon";
import {
  pathAllowedByHubAccess,
  pathAllowedBySponsors,
} from "../../lib/nav/hub-access-filter";
import { useClientAccessProfile } from "../../lib/nav/use-client-access";
import {
  DEFAULT_COCKPIT_PREFS,
  parseCockpitPrefs,
  type CockpitPrefs,
} from "../../lib/cockpit/prefs";
import { ThemeToggle } from "../theme-provider";
import OfflineStoragePanel from "./offline-storage-panel";
import { HomeDefaultsPanel } from "./home-defaults-panel";

type Status = { tone: "ok" | "error"; text: string } | null;

/**
 * Account → Appearance. Everything a member can change about how Vantage looks:
 * theme, whether their team's accent applies to them, motion, density, and a
 * view of "Your apps" (the pinned places) with the button that opens their editor.
 */
export default function AppearancePanel({ orgId }: { orgId: string | null }) {
  const [org, setOrg] = useState<OrgBrandingView | null>(null);
  const [saved, setSaved] = useState<AppearancePrefs>({ ...DEFAULT_APPEARANCE_PREFS });
  const [prefs, setPrefs] = useState<AppearancePrefs>({ ...DEFAULT_APPEARANCE_PREFS });
  const [loaded, setLoaded] = useState(false);
  const [loadProblem, setLoadProblem] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const [pins, setPins] = useState<string[]>(defaultPinHrefs());
  const [islandLoaded, setIslandLoaded] = useState(false);
  const [islandProblem, setIslandProblem] = useState(false);
  const [islandAttempt, setIslandAttempt] = useState(0);
  const [cockpit, setCockpit] = useState<CockpitPrefs>({ ...DEFAULT_COCKPIT_PREFS });
  const [cockpitBusy, setCockpitBusy] = useState(false);
  const [cockpitLoaded, setCockpitLoaded] = useState(false);
  const [cockpitProblem, setCockpitProblem] = useState(false);
  const [cockpitNote, setCockpitNote] = useState<Status>(null);

  const access = useClientAccessProfile();

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setLoadProblem(false);
    void fetch("/api/branding", { cache: "no-store", signal: AbortSignal.timeout(8_000) })
      .then((response) => { if (!response.ok) throw new Error("Appearance unavailable"); return response.json(); })
      .then((data: { org?: OrgBrandingView | null; appearance?: unknown } | null) => {
        if (cancelled) return;
        const next = parseAppearancePrefs(data?.appearance);
        setOrg(data?.org ?? null);
        setSaved(next);
        setPrefs(next);
      })
      .catch(() => {
        if (!cancelled) setLoadProblem(true);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  useEffect(() => {
    let cancelled = false;
    setCockpitLoaded(false);
    setCockpitProblem(false);
    void fetch("/api/account/cockpit", { cache: "no-store", signal: AbortSignal.timeout(8_000) })
      .then((response) => { if (!response.ok) throw new Error("Preferences unavailable"); return response.json(); })
      .then((data: { cockpit?: unknown } | null) => {
        if (cancelled) return;
        const next = parseCockpitPrefs(data?.cockpit);
        setCockpit(next);
      })
      .catch(() => {
        if (!cancelled) setCockpitProblem(true);
      })
      .finally(() => { if (!cancelled) setCockpitLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIslandLoaded(false);
    setIslandProblem(false);
    void fetch("/api/navigation/preferences", { cache: "no-store", signal: AbortSignal.timeout(8_000) })
      .then((response) => { if (!response.ok) throw new Error("Shortcuts unavailable"); return response.json(); })
      .then((data: { tabs?: unknown } | null) => {
        if (cancelled) return;
        setPins(resolveStoredPins(data?.tabs));
      })
      .catch(() => {
        if (!cancelled) setIslandProblem(true);
      })
      .finally(() => {
        if (!cancelled) setIslandLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [islandAttempt]);

  // The editor lives in the app shell; this page follows what it saves.
  useEffect(() => {
    const follow = (event: Event) => {
      const tabs = (event as CustomEvent<{ tabs?: unknown }>).detail?.tabs;
      setPins(resolveStoredPins(tabs));
    };
    window.addEventListener(PINS_CHANGED_EVENT, follow);
    return () => window.removeEventListener(PINS_CHANGED_EVENT, follow);
  }, []);

  const visiblePins = useMemo(
    () =>
      resolvePins(pins).filter(
        (item) =>
          pathAllowedByHubAccess(item.href, access.hubAccess) &&
          pathAllowedBySponsors(item.href, access.sponsorsAllowed),
      ),
    [pins, access.hubAccess, access.sponsorsAllowed],
  );

  const dirty = !appearanceEquals(prefs, saved);

  /** Preview immediately; the save call only makes it stick across devices. */
  function preview(next: AppearancePrefs) {
    setPrefs(next);
    applyBranding({ org, appearance: next });
    broadcastAppearance({ org, appearance: next });
  }

  async function savePrefs(next: AppearancePrefs) {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/branding/appearance", {
        signal: AbortSignal.timeout(8_000),
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appearance: next }),
      });
      const data = (await response.json()) as { appearance?: unknown; error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", text: data.error ?? "Could not save appearance settings." });
        return;
      }
      const stored = parseAppearancePrefs(data.appearance);
      setSaved(stored);
      setPrefs(stored);
      applyBranding({ org, appearance: stored });
      broadcastAppearance({ org, appearance: stored });
      setStatus({ tone: "ok", text: "Saved to your profile — it follows you to every device." });
    } catch {
      setStatus({ tone: "error", text: "Could not save appearance settings." });
    } finally {
      setBusy(false);
    }
  }

  async function saveCockpit(next: CockpitPrefs) {
    setCockpitBusy(true);
    setCockpitNote(null);
    try {
      const response = await fetch("/api/account/cockpit", {
        signal: AbortSignal.timeout(8_000),
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cockpit: next }),
      });
      const data = (await response.json()) as { cockpit?: unknown; error?: string };
      if (!response.ok) {
        setCockpitNote({ tone: "error", text: data.error ?? "Couldn't save that. Try again." });
        return;
      }
      const stored = parseCockpitPrefs(data.cockpit);
      setCockpit(stored);
      setCockpitNote(null);
    } catch {
      setCockpitNote({ tone: "error", text: "Couldn't save that. Try again." });
    } finally {
      setCockpitBusy(false);
    }
  }

  return (
    <div className="appearance-stack">
      {loadProblem ? (
        <p className="app-muted" role="status">
          Your saved display settings didn&apos;t load, so these show the defaults.{" "}
          <Button size="sm" variant="ghost" onClick={() => setLoadAttempt(value => value + 1)}>Try again</Button>
        </p>
      ) : null}
      <section className="appearance-group">
        <ThemeToggle expanded />
      </section>

      <section className="appearance-group" aria-labelledby="appearance-density-title">
        <h3 id="appearance-density-title">Density</h3>
        <p>
          Compact fits more on screen. Tap targets stay the same size.
        </p>
        <ChoiceField<DensityPreference> label="Interface density" value={prefs.density} disabled={busy || !loaded}
          choices={[{ value: "comfortable", label: "Comfortable", hint: "Default spacing" }, { value: "compact", label: "Compact", hint: "Less space between items" }]}
          onChange={value => preview({ ...prefs, density: value })} />
      </section>

      {/* Theme and density are what most people change. Glass, motion, the
          cockpit options and the bottom island made this tab about 5,000px tall. */}
      <details className="appearance-more">
        <summary data-disclosure>More display settings</summary>
      <section className="appearance-group" aria-labelledby="appearance-clarity-title">
        <h3 id="appearance-clarity-title">Glass</h3>
        <p>
          Set the transparency of navigation bars.
        </p>
        <ChoiceField<ClarityPreference> label="Glass" value={prefs.clarity} disabled={busy || !loaded}
          choices={[{ value: "clear", label: "Clear", hint: "More of the page shows through" }, { value: "regular", label: "Regular", hint: "Default" }, { value: "solid", label: "Solid", hint: "Best in sunlight" }]}
          onChange={value => preview({ ...prefs, clarity: value })} />
      </section>

      <section className="appearance-group" aria-labelledby="appearance-motion-title">
        <h3 id="appearance-motion-title">Motion</h3>
        <p>
          Reduce animations for calmer transitions.
        </p>
        <ChoiceField<MotionPreference> label="Motion" value={prefs.motion} disabled={busy || !loaded}
          choices={[{ value: "full", label: "Full motion", hint: "Animated transitions" }, { value: "reduced", label: "Reduced motion", hint: "Calmer transitions" }]}
          onChange={value => preview({ ...prefs, motion: value })} />

      </section>

      {/* Code scan settings live on the Code page now (Scan settings); only the live-board switch,
          which is about this device, stays here. Saves on change like the theme does. */}
      {cockpitLoaded && !cockpitProblem ? (
        <section className="appearance-group" aria-labelledby="appearance-live-title">
          <h3 id="appearance-live-title">Live boards</h3>
          <label className="appearance-check">
            <input
              type="checkbox"
              checked={cockpit.pauseLiveWhenHidden}
              disabled={cockpitBusy}
              onChange={(event) => void saveCockpit({ ...cockpit, pauseLiveWhenHidden: event.target.checked })}
            />
            Pause My Day, schedule and rankings while this tab is hidden
          </label>
          {cockpitNote?.tone === "error" ? <p className="brand-notice error" role="alert">{cockpitNote.text}</p> : null}
        </section>
      ) : null}

      <section className="appearance-group" aria-labelledby="appearance-island-title">
        <h3 id="appearance-island-title">Your apps</h3>
        <p>
          The places you pin. The first {BAR_SLOTS} sit in the bottom bar on your phone; all of them show at the top
          of the menu and the sidebar.
        </p>
        {islandProblem ? <div><p role="alert">Your apps could not load.</p><Button type="button" variant="secondary" onClick={() => setIslandAttempt(current => current + 1)}>Try again</Button></div> : !islandLoaded ? (
          <p className="app-muted">Loading your apps…</p>
        ) : (
          <ol className="appearance-island-slots appearance-pins" aria-label="Your pinned apps, in order">
            {visiblePins.map((item) => (
              <li key={item.href} className="filled">
                <Icon name={item.icon} />
                {item.label}
              </li>
            ))}
          </ol>
        )}
        <div className="appearance-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={!islandLoaded || islandProblem}
            onClick={() => window.dispatchEvent(new CustomEvent(PINS_EDIT_EVENT))}
          >
            Edit your apps
          </Button>
        </div>
      </section>
      </details>
      <div className="appearance-save">
        <div className="appearance-actions">
          <Button
            type="button"
            variant="primary"
            disabled={busy || !loaded || !dirty}
            onClick={() => void savePrefs(prefs)}
          >
            {busy ? "Saving…" : !loaded ? "Loading…" : dirty ? "Save appearance" : "Saved"}
          </Button>
          <Button
            type="button"
            disabled={busy || !loaded || appearanceEquals(prefs, DEFAULT_APPEARANCE_PREFS)}
            onClick={() => void savePrefs({ ...DEFAULT_APPEARANCE_PREFS })}
          >
            Reset to defaults
          </Button>
        </div>
        {status ? (
          <p className={`brand-notice ${status.tone === "ok" ? "ok" : "error"}`} role="status">
            {status.text}
          </p>
        ) : null}
      </div>
      <HomeDefaultsPanel orgId={orgId} />
      <OfflineStoragePanel />
    </div>
  );
}
