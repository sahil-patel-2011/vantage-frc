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
import { brandingLogoUrl, type OrgBrandingView } from "../../lib/branding/branding";
import {
  ISLAND_SLOT_COUNT,
  defaultIslandHrefs,
  defaultIslandLabelList,
  isDefaultIslandSelection,
  isValidIslandSelection,
  toggleIslandDraft,
} from "../../lib/nav/island-preferences";
import { ISLAND_TAB_CATALOG } from "../../lib/nav/product-nav";
import {
  pathAllowedByHubAccess,
  pathAllowedBySponsors,
} from "../../lib/nav/hub-access-filter";
import { useClientAccessProfile } from "../../lib/nav/use-client-access";
import {
  BUGBOT_INSTRUCTION_MAX,
  DEFAULT_COCKPIT_PREFS,
  cockpitEquals,
  parseCockpitPrefs,
  type CockpitPrefs,
} from "../../lib/cockpit/prefs";
import { ThemeToggle } from "../theme-provider";
import OfflineStoragePanel from "./offline-storage-panel";
import { HomeDefaultsPanel } from "./home-defaults-panel";

type Status = { tone: "ok" | "error"; text: string } | null;

/**
 * Account → Appearance. Everything a member can change about how Vantage looks:
 * theme, whether their team's accent applies to them, motion, density, and the
 * four apps on the bottom island (which otherwise only surfaces behind a
 * long-press most people never discover).
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

  const [islandSaved, setIslandSaved] = useState<string[]>(defaultIslandHrefs());
  const [islandDraft, setIslandDraft] = useState<string[]>(defaultIslandHrefs());
  const [islandBusy, setIslandBusy] = useState(false);
  const [islandNote, setIslandNote] = useState<string | null>(null);
  const [islandLoaded, setIslandLoaded] = useState(false);
  const [islandProblem, setIslandProblem] = useState(false);
  const [islandAttempt, setIslandAttempt] = useState(0);
  const [cockpitSaved, setCockpitSaved] = useState<CockpitPrefs>({ ...DEFAULT_COCKPIT_PREFS });
  const [cockpit, setCockpit] = useState<CockpitPrefs>({ ...DEFAULT_COCKPIT_PREFS });
  const [cockpitBusy, setCockpitBusy] = useState(false);
  const [cockpitLoaded, setCockpitLoaded] = useState(false);
  const [cockpitProblem, setCockpitProblem] = useState(false);
  const [cockpitAttempt, setCockpitAttempt] = useState(0);
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
        setCockpitSaved(next);
        setCockpit(next);
      })
      .catch(() => {
        if (!cancelled) setCockpitProblem(true);
      })
      .finally(() => { if (!cancelled) setCockpitLoaded(true); });
    return () => { cancelled = true; };
  }, [cockpitAttempt]);

  useEffect(() => {
    let cancelled = false;
    setIslandLoaded(false);
    setIslandProblem(false);
    void fetch("/api/navigation/preferences", { cache: "no-store", signal: AbortSignal.timeout(8_000) })
      .then((response) => { if (!response.ok) throw new Error("Shortcuts unavailable"); return response.json(); })
      .then((data: { tabs?: unknown } | null) => {
        if (cancelled) return;
        const tabs = isValidIslandSelection(data?.tabs) ? data.tabs : defaultIslandHrefs();
        setIslandSaved(tabs);
        setIslandDraft(tabs);
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

  const visibleCatalog = useMemo(
    () =>
      ISLAND_TAB_CATALOG.filter(
        (item) =>
          pathAllowedByHubAccess(item.href, access.hubAccess) &&
          pathAllowedBySponsors(item.href, access.sponsorsAllowed),
      ),
    [access.hubAccess, access.sponsorsAllowed],
  );

  const logoUrl = org ? brandingLogoUrl(org) : null;
  const dirty = !appearanceEquals(prefs, saved);
  const islandDirty =
    islandDraft.length === ISLAND_SLOT_COUNT &&
    islandDraft.join("|") !== islandSaved.join("|");

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
        setCockpitNote({ tone: "error", text: data.error ?? "Could not save cockpit settings." });
        return;
      }
      const stored = parseCockpitPrefs(data.cockpit);
      setCockpitSaved(stored);
      setCockpit(stored);
      setCockpitNote({
        tone: "ok",
        text: "Saved. Bugbot and live boards will use these next time they load.",
      });
    } catch {
      setCockpitNote({ tone: "error", text: "Could not save cockpit settings." });
    } finally {
      setCockpitBusy(false);
    }
  }

  async function saveIsland(tabs: string[], successText: string) {
    if (!isValidIslandSelection(tabs)) {
      setIslandNote(`Pick exactly ${ISLAND_SLOT_COUNT} apps.`);
      return;
    }
    setIslandBusy(true);
    setIslandNote(null);
    try {
      const response = await fetch("/api/navigation/preferences", {
        signal: AbortSignal.timeout(8_000),
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tabs }),
      });
      const data = (await response.json()) as { tabs?: unknown; error?: string };
      if (!response.ok) {
        setIslandNote(data.error ?? "Could not save your shortcuts.");
        return;
      }
      const stored = isValidIslandSelection(data.tabs) ? data.tabs : tabs;
      setIslandSaved(stored);
      setIslandDraft(stored);
      setIslandNote(successText);
    } catch {
      setIslandNote("Could not save your shortcuts.");
    } finally {
      setIslandBusy(false);
    }
  }

  return (
    <div className="appearance-stack">
      <section className="appearance-group">
        <ThemeToggle expanded />
      </section>

      <section className="appearance-group" aria-labelledby="appearance-accent-title">
        <h3 id="appearance-accent-title">Team colour</h3>
        {loadProblem ? (<p>Your appearance settings could not load.</p>) : !loaded ? (
          <p className="app-muted">Loading your team’s branding…</p>
        ) : !org ? (
          <p>
            Join a team to use its colours.
          </p>
        ) : !org.accentColor ? (
          <p>
            Using the Vantage accent.{" "}
            {org.canEdit ? (
              <a href={`/team/admin?orgId=${encodeURIComponent(org.orgId)}#team-branding`}>
                Set the team colour
              </a>
            ) : (
              "Your team admin can choose a team colour."
            )}
          </p>
        ) : !org.applyAccentToApp ? (
          <p>
            Team colours are off. Using the Vantage accent.
          </p>
        ) : (
          <>
            <p>
              Choose your accent. This only changes your view.
            </p>
            <ChoiceField label="Accent colour" value={prefs.teamAccent ? "team" : "vantage"} disabled={busy || !loaded || loadProblem}
              choices={[{ value: "team", label: "Team accent", hint: `Match ${org.orgName ?? "your team"}` }, { value: "vantage", label: "Vantage", hint: "Default accent" }]}
              onChange={value => preview({ ...prefs, teamAccent: value === "team" })} />
          </>
        )}
        {logoUrl && org?.showLogoInHeader ? (
          <p className="app-muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="soft-brand-mark" aria-hidden="true">
              { }
              <img src={logoUrl} alt="" />
            </span>
            Your team logo appears wherever this team is named.
          </p>
        ) : null}
      </section>

      <section className="appearance-group" aria-labelledby="appearance-density-title">
        <h3 id="appearance-density-title">Density</h3>
        <p>
          Compact fits more on screen. Tap targets stay the same size.
        </p>
        <ChoiceField<DensityPreference> label="Interface density" value={prefs.density} disabled={busy || !loaded || loadProblem}
          choices={[{ value: "comfortable", label: "Comfortable", hint: "Default spacing" }, { value: "compact", label: "Compact", hint: "Less space between items" }]}
          onChange={value => preview({ ...prefs, density: value })} />
      </section>

      {/* Theme, team colour and density are what most people change. Glass, motion, the
          cockpit options and the bottom island made this tab about 5,000px tall. */}
      <details className="appearance-more">
        <summary data-disclosure>More display settings</summary>
      <section className="appearance-group" aria-labelledby="appearance-clarity-title">
        <h3 id="appearance-clarity-title">Glass</h3>
        <p>
          Set the transparency of navigation bars.
        </p>
        <ChoiceField<ClarityPreference> label="Glass" value={prefs.clarity} disabled={busy || !loaded || loadProblem}
          choices={[{ value: "clear", label: "Clear", hint: "More of the page shows through" }, { value: "regular", label: "Regular", hint: "Default" }, { value: "solid", label: "Solid", hint: "Best in sunlight" }]}
          onChange={value => preview({ ...prefs, clarity: value })} />
      </section>

      <section className="appearance-group" aria-labelledby="appearance-motion-title">
        <h3 id="appearance-motion-title">Motion</h3>
        <p>
          Reduce animations for calmer transitions.
        </p>
        <ChoiceField<MotionPreference> label="Motion" value={prefs.motion} disabled={busy || !loaded || loadProblem}
          choices={[{ value: "full", label: "Full motion", hint: "Animated transitions" }, { value: "reduced", label: "Reduced motion", hint: "Calmer transitions" }]}
          onChange={value => preview({ ...prefs, motion: value })} />

      </section>

      <section className="appearance-group" aria-labelledby="appearance-cockpit-title">
        <h3 id="appearance-cockpit-title">Code preferences</h3>
        <p>
          Code review and live-update preferences.
        </p>
        {!cockpitLoaded ? <p role="status">Loading code preferences…</p> : cockpitProblem ? <div><p role="alert">Your code preferences could not load.</p><Button type="button" variant="secondary" onClick={() => setCockpitAttempt(current => current + 1)}>Retry code preferences</Button></div> : null}
        <label className="appearance-check">
          <input
            type="checkbox"
            checked={cockpit.confirmWrites}
            disabled={cockpitBusy || !cockpitLoaded || cockpitProblem}
            onChange={(event) => setCockpit({ ...cockpit, confirmWrites: event.target.checked })}
          />
          Confirm before Bugbot opens a pull request
        </label>
        <label className="appearance-check">
          <input
            type="checkbox"
            checked={cockpit.pauseLiveWhenHidden}
            disabled={cockpitBusy || !cockpitLoaded || cockpitProblem}
            onChange={(event) => setCockpit({ ...cockpit, pauseLiveWhenHidden: event.target.checked })}
          />
          Pause live boards (My Day, schedule, rankings) when this tab is hidden
        </label>
        <label className="appearance-check">
          <input
            type="checkbox"
            checked={cockpit.includeScanTests}
            disabled={cockpitBusy || !cockpitLoaded || cockpitProblem}
            onChange={(event) => setCockpit({ ...cockpit, includeScanTests: event.target.checked })}
          />
          Include our own tests when Bugbot scans a repo
        </label>
        <label>
          Default Bugbot mode
          <select
            value={cockpit.defaultBugbotMode}
            disabled={cockpitBusy || !cockpitLoaded || cockpitProblem}
            onChange={(event) =>
              setCockpit({
                ...cockpit,
                defaultBugbotMode: event.target.value === "ultra" ? "ultra" : "subscription",
              })
            }
          >
            <option value="subscription">Your key / subscription</option>
            <option value="ultra">Bugbot Ultra (hosted)</option>
          </select>
        </label>
        <label>
          Bugbot instructions
          <textarea
            value={cockpit.bugbotInstructions}
            maxLength={BUGBOT_INSTRUCTION_MAX}
            rows={3}
            disabled={cockpitBusy || !cockpitLoaded || cockpitProblem}
            placeholder="e.g. Never retune CAN id 3. Phoenix 6 current limit is 40 A."
            onChange={(event) => setCockpit({ ...cockpit, bugbotInstructions: event.target.value })}
          />
          <small className="app-muted">
            {cockpit.bugbotInstructions.length}/{BUGBOT_INSTRUCTION_MAX} · empty means no extra rules
          </small>
        </label>
        <div className="appearance-actions">
          <button
            type="button"
            className="primary"
            disabled={cockpitBusy || !cockpitLoaded || cockpitProblem || cockpitEquals(cockpit, cockpitSaved)}
            onClick={() => void saveCockpit(parseCockpitPrefs(cockpit))}
          >
            {cockpitBusy ? "Saving…" : "Save code preferences"}
          </button>
          <Button as="a" variant="secondary" href="/ai/connect">
            Connect AI
          </Button>
          <Button as="a" variant="secondary" href="/cad/setup">
            Onshape CAD
          </Button>
        </div>
        {cockpitNote ? (
          <p className={`brand-notice ${cockpitNote.tone === "ok" ? "ok" : "error"}`} role="status">
            {cockpitNote.text}
          </p>
        ) : null}
      </section>

      <section className="appearance-group" aria-labelledby="appearance-island-title">
        <h3 id="appearance-island-title">Bottom shortcuts</h3>
        <p>
          Choose four apps in order. Tap again to remove.
        </p>
        <div
          className="appearance-island-slots"
          aria-label={`${islandDraft.length} of ${ISLAND_SLOT_COUNT} island apps selected`}
        >
          {Array.from({ length: ISLAND_SLOT_COUNT }, (_, slot) => {
            const href = islandDraft[slot];
            const entry = ISLAND_TAB_CATALOG.find((item) => item.href === href);
            return (
              <span className={href ? "filled" : ""} key={slot}>
                {entry ? entry.label : `Slot ${slot + 1}`}
              </span>
            );
          })}
        </div>
        {islandProblem ? <div><p role="alert">Your shortcuts could not load.</p><Button type="button" variant="secondary" onClick={() => setIslandAttempt(current => current + 1)}>Retry shortcuts</Button></div> : !islandLoaded ? (
          <p className="app-muted">Loading your island…</p>
        ) : (
          <div className="appearance-island-grid">
            {visibleCatalog.map((item) => {
              const selected = islandDraft.includes(item.href);
              const full = !selected && islandDraft.length >= ISLAND_SLOT_COUNT;
              return (
                <button
                  key={item.href}
                  type="button"
                  className={selected ? "selected" : ""}
                  aria-pressed={selected}
                  disabled={full || islandBusy}
                  onClick={() => {
                    const result = toggleIslandDraft(islandDraft, item.href);
                    setIslandDraft(result.draft);
                    setIslandNote(result.error);
                  }}
                >
                  <strong>{item.label}</strong>
                  <small>{selected ? `Slot ${islandDraft.indexOf(item.href) + 1}` : "Add"}</small>
                </button>
              );
            })}
          </div>
        )}
        <div className="appearance-actions">
          <button
            type="button"
            className="primary"
            disabled={islandBusy || !islandLoaded || islandProblem || !islandDirty}
            onClick={() =>
              void saveIsland(islandDraft, "Shortcuts saved.")
            }
          >
            {islandBusy ? "Saving…" : `Save ${islandDraft.length}/${ISLAND_SLOT_COUNT}`}
          </button>
          <button
            type="button"
            disabled={islandBusy || !islandLoaded || islandProblem || isDefaultIslandSelection(islandSaved)}
            onClick={() =>
              void saveIsland(
                defaultIslandHrefs(),
                `Shortcuts reset to ${defaultIslandLabelList()}. `,
              )
            }
          >
            Reset shortcuts
          </button>
          {islandDirty ? (
            <button type="button" disabled={islandBusy} onClick={() => setIslandDraft(islandSaved)}>
              Discard
            </button>
          ) : null}
        </div>
        {islandNote ? (
          <p className="brand-notice" role="status">
            {islandNote}
          </p>
        ) : null}
      </section>
      </details>
      <div className="appearance-save">
        {loadProblem ? <p role="status">Could not load your saved appearance. <Button onClick={() => setLoadAttempt(value => value + 1)}>Retry appearance</Button></p> : null}
        <div className="appearance-actions">
          <Button
            type="button"
            variant="primary"
            disabled={busy || !loaded || loadProblem || !dirty}
            onClick={() => void savePrefs(prefs)}
          >
            {busy ? "Saving…" : !loaded ? "Loading…" : loadProblem || dirty ? "Save appearance" : "Saved"}
          </Button>
          <Button
            type="button"
            disabled={busy || !loaded || loadProblem || appearanceEquals(prefs, DEFAULT_APPEARANCE_PREFS)}
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
