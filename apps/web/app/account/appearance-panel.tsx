"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_APPEARANCE_PREFS,
  appearanceEquals,
  parseAppearancePrefs,
  type AppearancePrefs,
  type DensityPreference,
  type MotionPreference,
} from "../../lib/branding/appearance";
import { applyBranding, broadcastAppearance } from "../../lib/branding/appearance-runtime";
import { brandingLogoUrl, type OrgBrandingView } from "../../lib/branding/branding";
import { buildAccentPlan } from "../../lib/branding/colors";
import {
  ISLAND_SLOT_COUNT,
  defaultIslandHrefs,
  defaultIslandSentence,
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

type Status = { tone: "ok" | "error"; text: string } | null;

/**
 * Account → Appearance. Everything a member can change about how Vantage looks:
 * theme, whether their team's accent applies to them, motion, density, and the
 * four apps on the bottom island (which otherwise only surfaces behind a
 * long-press most people never discover).
 */
export default function AppearancePanel() {
  const [org, setOrg] = useState<OrgBrandingView | null>(null);
  const [saved, setSaved] = useState<AppearancePrefs>({ ...DEFAULT_APPEARANCE_PREFS });
  const [prefs, setPrefs] = useState<AppearancePrefs>({ ...DEFAULT_APPEARANCE_PREFS });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const [islandSaved, setIslandSaved] = useState<string[]>(defaultIslandHrefs());
  const [islandDraft, setIslandDraft] = useState<string[]>(defaultIslandHrefs());
  const [islandBusy, setIslandBusy] = useState(false);
  const [islandNote, setIslandNote] = useState<string | null>(null);
  const [islandLoaded, setIslandLoaded] = useState(false);
  const [cockpitSaved, setCockpitSaved] = useState<CockpitPrefs>({ ...DEFAULT_COCKPIT_PREFS });
  const [cockpit, setCockpit] = useState<CockpitPrefs>({ ...DEFAULT_COCKPIT_PREFS });
  const [cockpitBusy, setCockpitBusy] = useState(false);
  const [cockpitNote, setCockpitNote] = useState<Status>(null);

  const access = useClientAccessProfile();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/branding", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { org?: OrgBrandingView | null; appearance?: unknown } | null) => {
        if (cancelled) return;
        const next = parseAppearancePrefs(data?.appearance);
        setOrg(data?.org ?? null);
        setSaved(next);
        setPrefs(next);
      })
      .catch(() => {
        /* keep defaults — nothing is fabricated, the toggles just start neutral */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    void fetch("/api/account/cockpit", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { cockpit?: unknown } | null) => {
        if (cancelled) return;
        const next = parseCockpitPrefs(data?.cockpit);
        setCockpitSaved(next);
        setCockpit(next);
      })
      .catch(() => {
        /* defaults stay */
      });

    void fetch("/api/navigation/preferences", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { tabs?: unknown } | null) => {
        if (cancelled) return;
        const tabs = isValidIslandSelection(data?.tabs) ? data.tabs : defaultIslandHrefs();
        setIslandSaved(tabs);
        setIslandDraft(tabs);
      })
      .catch(() => {
        /* offline: the editor still works, it just starts from the defaults */
      })
      .finally(() => {
        if (!cancelled) setIslandLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleCatalog = useMemo(
    () =>
      ISLAND_TAB_CATALOG.filter(
        (item) =>
          pathAllowedByHubAccess(item.href, access.hubAccess) &&
          pathAllowedBySponsors(item.href, access.sponsorsAllowed),
      ),
    [access.hubAccess, access.sponsorsAllowed],
  );

  const accentPlan = useMemo(
    () => (org?.accentColor ? buildAccentPlan(org.accentColor) : null),
    [org?.accentColor],
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
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tabs }),
      });
      const data = (await response.json()) as { tabs?: unknown; error?: string };
      if (!response.ok) {
        setIslandNote(data.error ?? "Could not save your island.");
        return;
      }
      const stored = isValidIslandSelection(data.tabs) ? data.tabs : tabs;
      setIslandSaved(stored);
      setIslandDraft(stored);
      setIslandNote(successText);
    } catch {
      setIslandNote("Could not save your island.");
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
        {!loaded ? (
          <p className="app-muted">Loading your team’s branding…</p>
        ) : !org ? (
          <p>
            You are not in a team workspace yet, so there is no team colour to apply. Vantage stays on
            its default accent.
          </p>
        ) : !org.accentColor ? (
          <p>
            {org.orgName ?? "Your team"} has not chosen a colour yet, so Vantage uses its default
            accent.{" "}
            {org.canEdit ? (
              <a href={`/team/admin?orgId=${encodeURIComponent(org.orgId)}#team-branding`}>
                Set the team colour
              </a>
            ) : (
              "An owner or admin can set one in Team admin."
            )}
          </p>
        ) : !org.applyAccentToApp ? (
          <p>
            {org.orgName ?? "Your team"} picked {org.accentColor} but turned off applying it across the
            app, so this setting has nothing to switch on yet.
          </p>
        ) : (
          <>
            <p>
              {org.orgName ?? "Your team"} uses{" "}
              <code>{org.accentColor}</code>. Turn it off to stay on the neutral Vantage accent — this
              only changes what <em>you</em> see.
            </p>
            <div className="appearance-choice" role="radiogroup" aria-label="Accent colour">
              <button
                type="button"
                role="radio"
                aria-checked={prefs.teamAccent}
                disabled={busy}
                onClick={() => preview({ ...prefs, teamAccent: true })}
              >
                <span style={{ color: accentPlan?.light.accent }}>Team accent</span>
                <small>Match {org.orgName ?? "your team"}</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!prefs.teamAccent}
                disabled={busy}
                onClick={() => preview({ ...prefs, teamAccent: false })}
              >
                <span>Neutral</span>
                <small>Vantage default blue</small>
              </button>
            </div>
          </>
        )}
        {logoUrl && org?.showLogoInHeader ? (
          <p className="app-muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="soft-brand-mark" aria-hidden="true">
              { }
              <img src={logoUrl} alt="" />
            </span>
            Your team logo appears wherever this workspace is named.
          </p>
        ) : null}
      </section>

      <section className="appearance-group" aria-labelledby="appearance-density-title">
        <h3 id="appearance-density-title">Density</h3>
        <p>
          Compact trims whitespace so more fits on a pit laptop or a phone in the stands. Buttons keep
          their full tap size either way.
        </p>
        <div className="appearance-choice" role="radiogroup" aria-label="Interface density">
          {(
            [
              ["comfortable", "Comfortable", "Default spacing"],
              ["compact", "Compact", "About 20% tighter"],
            ] as [DensityPreference, string, string][]
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={prefs.density === value}
              disabled={busy}
              onClick={() => preview({ ...prefs, density: value })}
            >
              <span>{label}</span>
              <small>{hint}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="appearance-group" aria-labelledby="appearance-motion-title">
        <h3 id="appearance-motion-title">Motion</h3>
        <p>
          Reduced turns off the sheet, drag, and splash animations Vantage drives in JavaScript — the
          ones your device’s own “reduce motion” setting cannot reach.
        </p>
        <div className="appearance-choice" role="radiogroup" aria-label="Motion">
          {(
            [
              ["full", "Full motion", "Animated sheets and drags"],
              ["reduced", "Reduced motion", "Instant transitions"],
            ] as [MotionPreference, string, string][]
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={prefs.motion === value}
              disabled={busy}
              onClick={() => preview({ ...prefs, motion: value })}
            >
              <span>{label}</span>
              <small>{hint}</small>
            </button>
          ))}
        </div>
        <div className="appearance-actions">
          <button
            type="button"
            className="primary"
            disabled={busy || !dirty}
            onClick={() => void savePrefs(prefs)}
          >
            {busy ? "Saving…" : dirty ? "Save appearance" : "Saved"}
          </button>
          <button
            type="button"
            disabled={busy || appearanceEquals(prefs, DEFAULT_APPEARANCE_PREFS)}
            onClick={() => void savePrefs({ ...DEFAULT_APPEARANCE_PREFS })}
          >
            Reset to defaults
          </button>
        </div>
        {status ? (
          <p className={`brand-notice ${status.tone === "ok" ? "ok" : "error"}`} role="status">
            {status.text}
          </p>
        ) : null}
      </section>

      <details className="appearance-group appearance-advanced">
        <summary>Advanced workspace preferences</summary>
        <div className="appearance-advanced-body">
          <section aria-labelledby="appearance-cockpit-title">
            <h3 id="appearance-cockpit-title">Cockpit</h3>
            <p>
              Personal defaults for Bugbot and live boards.
            </p>
        <label className="appearance-check">
          <input
            type="checkbox"
            checked={cockpit.confirmWrites}
            disabled={cockpitBusy}
            onChange={(event) => setCockpit({ ...cockpit, confirmWrites: event.target.checked })}
          />
          Confirm before Bugbot opens a pull request
        </label>
        <label className="appearance-check">
          <input
            type="checkbox"
            checked={cockpit.pauseLiveWhenHidden}
            disabled={cockpitBusy}
            onChange={(event) => setCockpit({ ...cockpit, pauseLiveWhenHidden: event.target.checked })}
          />
          Pause live boards (My Day, schedule, rankings) when this tab is hidden
        </label>
        <label className="appearance-check">
          <input
            type="checkbox"
            checked={cockpit.includeScanTests}
            disabled={cockpitBusy}
            onChange={(event) => setCockpit({ ...cockpit, includeScanTests: event.target.checked })}
          />
          Include our own tests when Bugbot scans a repo
        </label>
        <label>
          Default Bugbot mode
          <select
            value={cockpit.defaultBugbotMode}
            disabled={cockpitBusy}
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
            disabled={cockpitBusy}
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
            disabled={cockpitBusy || cockpitEquals(cockpit, cockpitSaved)}
            onClick={() => void saveCockpit(parseCockpitPrefs(cockpit))}
          >
            {cockpitBusy ? "Saving…" : "Save cockpit"}
          </button>
        </div>
            {cockpitNote ? (
              <p className={`brand-notice ${cockpitNote.tone === "ok" ? "ok" : "error"}`} role="status">
                {cockpitNote.text}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="appearance-island-title">
            <h3 id="appearance-island-title">Bottom island</h3>
            <p>
              Choose the four shortcuts at the bottom of every screen. Tap in the order you want them;
              tap a chosen app again to remove it.
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
        {!islandLoaded ? (
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
            disabled={islandBusy || !islandDirty}
            onClick={() =>
              void saveIsland(islandDraft, "Island saved. It appears on your next page load.")
            }
          >
            {islandBusy ? "Saving…" : `Save ${islandDraft.length}/${ISLAND_SLOT_COUNT}`}
          </button>
          <button
            type="button"
            disabled={islandBusy || isDefaultIslandSelection(islandSaved)}
            onClick={() =>
              void saveIsland(
                defaultIslandHrefs(),
                `Island reset to ${defaultIslandSentence()}. It appears on your next page load.`,
              )
            }
          >
            Reset to default four
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
        </div>
      </details>
    </div>
  );
}
