"use client";

import { Panel, Button } from "../../components/ui";
import type { AccountView, EmailPrefs, NotificationPrefs } from "./account-types";

/**
 * The Account → Notifications tab points to the one settings screen.
 *
 * It used to carry its own copy of every switch (with Team chat and push),
 * while /notifications/preferences had a slightly different list. Two screens
 * that disagree is worse than one link, so every switch now lives on
 * /notifications/preferences. The extra props stay so Account's tab wiring is
 * unchanged.
 */
export function AccountNotificationsPanel({
  account,
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
  const emailOn = account.emailDelivery?.status === "available" && /is on/i.test(account.emailDelivery.detail);
  return (
    <Panel className="account-panel">
      <h2>Notifications</h2>
      <p className="app-muted">
        Inbox alerts (including Team chat), push on this device, and email are all on one screen.
      </p>
      <p className="app-muted">
        {emailOn
          ? "Emails are on for this team."
          : "Emails are off on this server, so you'll get inbox alerts but no email."}
      </p>
      <div className="account-actions">
        <Button as="a" variant="primary" href="/notifications/preferences">
          Open notification settings
        </Button>
        <a href="/notifications">Open inbox</a>
      </div>
    </Panel>
  );
}
