import NotificationPreferencesClient from "./preferences-client";

export const metadata = {
  title: "Notification preferences",
};

/** Preference center for in-app event toggles + email opt-ins (also linked from email footers). */
export default function NotificationPreferencesPage() {
  return <NotificationPreferencesClient />;
}
