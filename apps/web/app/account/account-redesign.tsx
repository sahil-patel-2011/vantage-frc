"use client";

import { useState } from "react";
import { Icon } from "../../components/icon";
import { signOutAndRedirect } from "../../lib/sign-out";
import type { Me } from "../../components/app-shell-model";

/**
 * Mobile-first account page redesign matching the design mockup.
 * Shows profile hero, segmented tabs, and notification settings.
 */

export function AccountRedesign({ me }: { me: Me }) {
  const [tab, setTab] = useState<"general" | "integrations">("general");
  const [prefs, setPrefs] = useState({
    dailyEmails: false,
    hideReleaseNotes: false,
    muteNotifications: false,
  });

  const name = me.firstName || me.name?.split(" ")[0] || me.email?.split("@")[0] || "User";
  const fullName = me.name || `${name} Patel`;
  const email = me.email || "user@example.com";
  const initial = name.charAt(0).toUpperCase();
  const role = me.role || "Admin";
  const memberSince = "Mar 2026";

  function togglePref(key: keyof typeof prefs) {
    setPrefs((current) => ({ ...current, [key]: !current[key] }));
  }

  async function handleSignOut() {
    await signOutAndRedirect("/");
  }

  return (
    <main className="vt-page" id="main-content">
      {/* Profile Hero */}
      <div className="vt-account-hero">
        <div className="vt-account-avatar">{initial}</div>
        <h1 className="vt-account-name">{fullName}</h1>
        <p className="vt-account-email">{email}</p>
        <div className="vt-account-meta">
          <div className="vt-account-meta-item">
            <div className="vt-account-meta-label">Role</div>
            <div className="vt-account-meta-value">{role}</div>
          </div>
          <div className="vt-account-meta-item">
            <div className="vt-account-meta-label">Member since</div>
            <div className="vt-account-meta-value">{memberSince}</div>
          </div>
        </div>
      </div>

      {/* Segmented Control */}
      <div className="vt-segmented">
        <button
          className="vt-segmented-btn"
          data-active={tab === "general"}
          onClick={() => setTab("general")}
        >
          General
        </button>
        <button
          className="vt-segmented-btn"
          data-active={tab === "integrations"}
          onClick={() => setTab("integrations")}
        >
          Integrations
        </button>
      </div>

      {tab === "general" ? (
        <div className="vt-card">
          <div className="vt-flex vt-items-center vt-gap-2 vt-mb-4">
            <Icon name="bell" />
            <h2 style={{ font: "700 15px var(--vt-font)", color: "var(--vt-ink)" }}>
              Notifications &amp; Preferences
            </h2>
          </div>

          <div className="vt-settings-row">
            <div className="vt-settings-text">
              <div className="vt-settings-title">Daily Performance Emails</div>
              <div className="vt-settings-sub">Automated daily recap of team performance at events.</div>
            </div>
            <button
              className="vt-toggle"
              data-on={prefs.dailyEmails}
              onClick={() => togglePref("dailyEmails")}
              aria-label="Toggle daily performance emails"
            />
          </div>

          <div className="vt-settings-row">
            <div className="vt-settings-text">
              <div className="vt-settings-title">Hide Release Notes Popups</div>
              <div className="vt-settings-sub">Don&apos;t show &lsquo;What&apos;s New&rsquo; popup after updates.</div>
            </div>
            <button
              className="vt-toggle"
              data-on={prefs.hideReleaseNotes}
              onClick={() => togglePref("hideReleaseNotes")}
              aria-label="Toggle release notes popups"
            />
          </div>

          <div className="vt-settings-row">
            <div className="vt-settings-text">
              <div className="vt-settings-title">Mute Notifications</div>
              <div className="vt-settings-sub">Silence all non-critical in-app notifications.</div>
            </div>
            <button
              className="vt-toggle"
              data-on={prefs.muteNotifications}
              onClick={() => togglePref("muteNotifications")}
              aria-label="Toggle mute notifications"
            />
          </div>
        </div>
      ) : (
        <div className="vt-card">
          <div className="vt-flex vt-items-center vt-gap-2 vt-mb-4">
            <Icon name="gear" />
            <h2 style={{ font: "700 15px var(--vt-font)", color: "var(--vt-ink)" }}>
              Integrations
            </h2>
          </div>
          <div className="vt-settings-row">
            <div className="vt-settings-text">
              <div className="vt-settings-title">The Blue Alliance</div>
              <div className="vt-settings-sub">Sync match data and event schedules.</div>
            </div>
            <span className="vt-sync-badge live">Connected</span>
          </div>
          <div className="vt-settings-row">
            <div className="vt-settings-text">
              <div className="vt-settings-title">Google Workspace</div>
              <div className="vt-settings-sub">Calendar and drive integration.</div>
            </div>
            <span style={{ font: "600 12px var(--vt-font)", color: "var(--vt-muted)" }}>Not connected</span>
          </div>
          <div className="vt-settings-row">
            <div className="vt-settings-text">
              <div className="vt-settings-title">Slack</div>
              <div className="vt-settings-sub">Send alerts to your team channel.</div>
            </div>
            <span style={{ font: "600 12px var(--vt-font)", color: "var(--vt-muted)" }}>Not connected</span>
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="vt-card-flat" style={{ marginTop: 16 }}>
        <a className="vt-settings-row" href="/whats-new" style={{ textDecoration: "none" }}>
          <div className="vt-settings-text">
            <div className="vt-settings-title">What&apos;s New</div>
            <div className="vt-settings-sub">See the latest updates and features.</div>
          </div>
          <Icon name="chevron" />
        </a>
        <a className="vt-settings-row" href="/support" style={{ textDecoration: "none" }}>
          <div className="vt-settings-text">
            <div className="vt-settings-title">Feedback</div>
            <div className="vt-settings-sub">Help us improve Vantage.</div>
          </div>
          <Icon name="chevron" />
        </a>
        <button className="vt-settings-row" onClick={() => void handleSignOut()} style={{ border: "none", background: "none", width: "100%", cursor: "pointer", textAlign: "left" }}>
          <div className="vt-settings-text">
            <div className="vt-settings-title" style={{ color: "var(--vt-red)" }}>Sign Out</div>
            <div className="vt-settings-sub">End this session on this device.</div>
          </div>
          <Icon name="logout" />
        </button>
      </div>

      <p style={{ textAlign: "center", font: "600 10px var(--vt-font)", letterSpacing: ".05em", color: "var(--vt-muted-light)", padding: "16px 0" }}>
        VANTAGE · FRC SCOUTING
      </p>
    </main>
  );
}
