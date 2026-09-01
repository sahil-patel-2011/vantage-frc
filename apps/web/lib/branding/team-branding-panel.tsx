"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { applyBranding, broadcastAppearance } from "./appearance-runtime";
import {
  DEFAULT_APPEARANCE_PREFS,
  parseAppearancePrefs,
  type AppearancePrefs,
} from "./appearance";
import {
  MAX_LOGO_UPLOAD_BYTES,
  brandingLogoUrl,
  formatLogoSize,
  type OrgBrandingView,
} from "./branding";
import { DEFAULT_ACCENT, buildAccentPlan, normalizeHexColor } from "./colors";

type Notice = { tone: "ok" | "warn" | "error"; text: string } | null;

/**
 * Team branding editor. Owners/admins pick the accent + logo here; everyone else
 * sees what the team chose and where to change their personal override.
 */
export function TeamBrandingPanel({ orgId }: { orgId: string }) {
  const [view, setView] = useState<OrgBrandingView | null>(null);
  const [appearance, setAppearance] = useState<AppearancePrefs>({ ...DEFAULT_APPEARANCE_PREFS });
  const [accentDraft, setAccentDraft] = useState("");
  const [showLogo, setShowLogo] = useState(true);
  const [applyAccent, setApplyAccent] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function adopt(next: OrgBrandingView) {
    setView(next);
    setAccentDraft(next.accentColor ?? "");
    setShowLogo(next.showLogoInHeader);
    setApplyAccent(next.applyAccentToApp);
  }

  async function load() {
    try {
      const response = await fetch(`/api/branding?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        org?: OrgBrandingView | null;
        appearance?: unknown;
        error?: string;
      };
      if (!response.ok || !data.org) {
        setNotice({
          tone: "warn",
          text: data.error ?? "Branding is unavailable for this workspace right now.",
        });
        setLoaded(true);
        return;
      }
      adopt(data.org);
      setAppearance(parseAppearancePrefs(data.appearance));
      setNotice(null);
    } catch {
      setNotice({ tone: "error", text: "Could not load team branding." });
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  // Live preview of whatever is typed, without saving.
  const plan = useMemo(() => buildAccentPlan(accentDraft), [accentDraft]);
  const draftHexValid = accentDraft.trim() === "" || plan !== null;
  const dirty =
    view !== null &&
    ((normalizeHexColor(accentDraft) ?? null) !== view.accentColor ||
      showLogo !== view.showLogoInHeader ||
      applyAccent !== view.applyAccentToApp);

  function repaint(next: OrgBrandingView) {
    applyBranding({ org: next, appearance });
    broadcastAppearance({ org: next, appearance });
  }

  async function save() {
    if (!view?.canEdit) return;
    if (!draftHexValid) {
      setNotice({ tone: "error", text: "Team colour must be a hex value like #1457d9." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/branding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          accentColor: accentDraft.trim() === "" ? null : normalizeHexColor(accentDraft),
          showLogoInHeader: showLogo,
          applyAccentToApp: applyAccent,
        }),
      });
      const data = (await response.json()) as { org?: OrgBrandingView; error?: string };
      if (!response.ok || !data.org) {
        setNotice({ tone: "error", text: data.error ?? "Could not save branding." });
        return;
      }
      adopt(data.org);
      repaint(data.org);
      setNotice({
        tone: "ok",
        text: data.org.accentColor
          ? `Saved. Everyone on team sees ${data.org.accentColor} unless they turn it off in their own Appearance settings.`
          : "Saved. Your team is back on the default Vantage accent.",
      });
    } catch {
      setNotice({ tone: "error", text: "Could not save branding." });
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!view?.canEdit) return;
    if (file.size > MAX_LOGO_UPLOAD_BYTES) {
      setNotice({ tone: "error", text: "Pick a logo under 2 MB." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("orgId", orgId);
      form.set("file", file);
      const response = await fetch("/api/branding/logo", { method: "POST", body: form });
      const data = (await response.json()) as { logo?: OrgBrandingView["logo"]; error?: string };
      if (!response.ok || !data.logo) {
        setNotice({ tone: "error", text: data.error ?? "Could not save the logo." });
        return;
      }
      setView((current) => (current ? { ...current, logo: data.logo! } : current));
      setNotice({ tone: "ok", text: "Logo saved. Members see it wherever your team is named." });
    } catch {
      setNotice({ tone: "error", text: "Could not save the logo." });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeLogo() {
    if (!view?.canEdit) return;
    setBusy(true);
    try {
      const response = await fetch("/api/branding/logo", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = (await response.json()) as { logo?: OrgBrandingView["logo"]; error?: string };
      if (!response.ok || !data.logo) {
        setNotice({ tone: "error", text: data.error ?? "Could not remove the logo." });
        return;
      }
      setView((current) => (current ? { ...current, logo: data.logo! } : current));
      setNotice({ tone: "ok", text: "Logo removed." });
    } catch {
      setNotice({ tone: "error", text: "Could not remove the logo." });
    } finally {
      setBusy(false);
    }
  }

  const logoUrl = view ? brandingLogoUrl(view) : null;
  const previewAccent = plan ?? buildAccentPlan(DEFAULT_ACCENT.light)!;

  return (
    <section className="app-card soft-panel brand-panel" id="team-branding" aria-labelledby="team-branding-title">
      <header className="brand-panel-head">
        <div>
          <span className="brand-panel-eyebrow">BRANDING</span>
          <h2 id="team-branding-title">Team colour &amp; logo</h2>
          <p>
            One accent and one logo, applied for every member of this workspace. Members can opt out
            individually in Account → Appearance; nobody can be forced into an unreadable colour.
          </p>
        </div>
      </header>

      {!loaded ? <p className="app-muted">Loading branding…</p> : null}

      {notice ? (
        <p
          className={`brand-notice${notice.tone === "ok" ? " ok" : notice.tone === "warn" ? " warn" : " error"}`}
          role="status"
        >
          {notice.text}
        </p>
      ) : null}

      {loaded && view ? (
        <>
          {!view.canEdit ? (
            <p className="app-muted brand-readonly" role="note">
              Only a team owner or admin can change the team colour and logo. You can still switch the
              team accent off for yourself in <a href="/account?tab=appearance">Account → Appearance</a>.
            </p>
          ) : null}

          <div className="brand-grid">
            <div className="brand-field">
              <label htmlFor="brand-accent-hex">Team colour</label>
              <div className="brand-color-row">
                <input
                  id="brand-accent-picker"
                  type="color"
                  aria-label="Pick team colour"
                  disabled={!view.canEdit || busy}
                  value={normalizeHexColor(accentDraft) ?? DEFAULT_ACCENT.light}
                  onChange={(event) => setAccentDraft(event.target.value)}
                />
                <input
                  id="brand-accent-hex"
                  type="text"
                  inputMode="text"
                  spellCheck={false}
                  placeholder={DEFAULT_ACCENT.light}
                  maxLength={7}
                  aria-invalid={!draftHexValid}
                  aria-describedby="brand-accent-help"
                  disabled={!view.canEdit || busy}
                  value={accentDraft}
                  onChange={(event) => setAccentDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={!view.canEdit || busy || accentDraft.trim() === ""}
                  onClick={() => setAccentDraft("")}
                >
                  Use default
                </button>
              </div>
              <small id="brand-accent-help" className="app-muted">
                {draftHexValid
                  ? "Six-digit hex, e.g. #1457d9. Leave blank for the stock Vantage blue."
                  : "That is not a hex colour — try #1457d9."}
              </small>
            </div>

            <div className="brand-field">
              <span className="brand-field-label">Preview</span>
              <div className="brand-preview-row">
                <div className="brand-preview" data-preview-theme="light">
                  <span className="brand-preview-chip" style={{ background: previewAccent.light.brand, color: previewAccent.light.brandInk }}>
                    Fill
                  </span>
                  <span className="brand-preview-text" style={{ color: previewAccent.light.accent }}>
                    Accent text
                  </span>
                  <small>Light · {previewAccent.light.guard.ratio.toFixed(1)}:1</small>
                </div>
                <div className="brand-preview" data-preview-theme="dark">
                  <span className="brand-preview-chip" style={{ background: previewAccent.dark.brand, color: previewAccent.dark.brandInk }}>
                    Fill
                  </span>
                  <span className="brand-preview-text" style={{ color: previewAccent.dark.accent }}>
                    Accent text
                  </span>
                  <small>Dark · {previewAccent.dark.guard.ratio.toFixed(1)}:1</small>
                </div>
              </div>
            </div>
          </div>

          {plan?.textUnsafe ? (
            <p className="brand-notice warn" role="alert">
              {plan.warning}
            </p>
          ) : null}

          <div className="brand-flags">
            <label className="brand-check">
              <input
                type="checkbox"
                disabled={!view.canEdit || busy}
                checked={applyAccent}
                onChange={(event) => setApplyAccent(event.target.checked)}
              />
              <span>
                <strong>Apply the team colour across the app</strong>
                <small>Off keeps branding to the logo only — useful mid-season when you are still deciding.</small>
              </span>
            </label>
            <label className="brand-check">
              <input
                type="checkbox"
                disabled={!view.canEdit || busy}
                checked={showLogo}
                onChange={(event) => setShowLogo(event.target.checked)}
              />
              <span>
                <strong>Show the logo next to the team name</strong>
                <small>Applies wherever this workspace is identified in-app.</small>
              </span>
            </label>
          </div>

          <div className="brand-logo">
            <div className="brand-logo-preview">
              {logoUrl ? (
                <span className="soft-brand-mark lg">
                  { }
                  <img src={logoUrl} alt={`${view.orgName ?? "Team"} logo`} />
                </span>
              ) : (
                <span className="soft-brand-mark lg" aria-hidden="true" />
              )}
              <div>
                <strong>{view.logo.present ? "Team logo" : "No logo yet"}</strong>
                <small className="app-muted">
                  {view.logo.present
                    ? `${view.logo.width}×${view.logo.height} · ${formatLogoSize(view.logo.byteSize)} · PNG`
                    : "PNG, JPEG, or WebP up to 2 MB. Stored as a flattened PNG no larger than 512px."}
                </small>
              </div>
            </div>
            {view.canEdit ? (
              <div className="brand-logo-actions">
                <input
                  ref={fileRef}
                  id="brand-logo-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadLogo(file);
                  }}
                />
                {view.logo.present ? (
                  <button type="button" className="app-button secondary" disabled={busy} onClick={() => void removeLogo()}>
                    Remove logo
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {view.canEdit ? (
            <div className="brand-actions">
              <button type="button" className="app-button" disabled={busy || !dirty || !draftHexValid} onClick={() => void save()}>
                {busy ? "Saving…" : "Save branding"}
              </button>
              {dirty ? (
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => adopt(view)}
                >
                  Discard changes
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default TeamBrandingPanel;
