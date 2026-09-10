"use client";

import { EmptyState, Panel } from "../../components/ui";
import { PushDevicePanel } from "./account-push-panel";
import {
  EMAIL_PREF_LABELS,
  PREF_LABELS,
  type AccountView,
  type EmailPrefs,
  type NotificationPrefs,
} from "./account-types";

export function AccountNotificationsPanel({
  account,
  orgId,
  prefs,
  emailPrefs,
  busy,
  onPrefsChange,
  onEmailPrefsChange,
  onSave,
}: {
  account: AccountView;
  orgId: string | null;
  prefs: NotificationPrefs;
  emailPrefs: EmailPrefs;
  busy: boolean;
  onPrefsChange: (next: NotificationPrefs) => void;
  onEmailPrefsChange: (next: EmailPrefs) => void;
  onSave: () => void;
}) {
  return (
    <Panel className="account-panel">
      {account.emailDelivery?.status === "setup_required" ? (
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="Email delivery not configured"
          description={account.emailDelivery.detail}
        >
          <p className="app-muted">
            In-app prefs still save. Opt-in email stays quiet until Resend is configured on this deployment.
          </p>
        </EmptyState>
      ) : null}
      <h2>In-app notifications</h2>
      <p className="app-muted">
        Controls what Vantage may put in your inbox — including coach→member todos, duties, and calendar events.
        It does not create live competition data.{" "}
        <a href="/notifications">Open inbox</a>
        {" · "}
        <a href="/notifications/preferences">Full preference center</a>
        {" · "}
        <a href="/whats-new">What’s new</a>
      </p>
      <ul className="account-prefs">
        {PREF_LABELS.map((item) => (
          <li key={item.key}>
            <div>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </div>
            <label className="account-switch">
              <span className="sr-only">{item.title}</span>
              <input
                type="checkbox"
                checked={prefs[item.key]}
                onChange={(event) => onPrefsChange({ ...prefs, [item.key]: event.target.checked })}
              />
            </label>
          </li>
        ))}
      </ul>

      <PushDevicePanel orgId={orgId} />

      <h2 className="account-prefs-heading">Email opt-ins</h2>
      <p className="app-muted">
        Email stays off until you explicitly opt in. Auth codes and security notices are separate.{" "}
        <a href="/notifications/preferences">Open email preference center</a>
        {" · "}
        <a href="/support">Help & Support</a>
      </p>
      <ul className="account-prefs">
        {EMAIL_PREF_LABELS.map((item) => (
          <li key={item.key}>
            <div>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </div>
            <label className="account-switch">
              <span className="sr-only">{item.title}</span>
              <input
                type="checkbox"
                checked={emailPrefs[item.key]}
                onChange={(event) =>
                  onEmailPrefsChange({ ...emailPrefs, [item.key]: event.target.checked })
                }
              />
            </label>
          </li>
        ))}
      </ul>
      <button className="primary-action" type="button" disabled={busy} onClick={() => void onSave()}>
        Save preferences
      </button>
    </Panel>
  );
}
