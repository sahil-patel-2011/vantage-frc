import { withRls } from "@vantage/db";
import { requirePlatformAdminPage } from "../../lib/platform-admin";
import { countNewFeedback } from "../../lib/feedback/admin-feedback";
import { AdminSubnav } from "./admin-subnav";

export const dynamic = "force-dynamic";

/**
 * Shared gate for Platform admin and all platform settings under `/admin/*`.
 * Org Team Admin lives under `/team/*` and is not covered here.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformAdminPage();
  // The count of new feedback rides on the tabs. It is a nicety: if it cannot be read, the tabs
  // simply show no number rather than taking the whole admin area down with them.
  const newFeedback = await withRls({ userId: session.user.id }, (client) => countNewFeedback(client)).catch(
    () => null,
  );
  return (
    <div className="admin-shell">
      <AdminSubnav newFeedback={newFeedback} />
      {children}
    </div>
  );
}
