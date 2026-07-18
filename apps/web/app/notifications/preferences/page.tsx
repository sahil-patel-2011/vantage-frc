import { redirect } from "next/navigation";

/** Deep link used by email preference footers (`buildPreferencesUrl`). */
export default function NotificationPreferencesPage() {
  redirect("/account?tab=notifications");
}
