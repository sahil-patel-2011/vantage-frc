import { requirePlatformAdminPage } from "../../lib/platform-admin";
import { AdminSubnav } from "./admin-subnav";

export const dynamic = "force-dynamic";

/**
 * Shared gate for Global Team Manager and all platform settings under `/admin/*`.
 * Org Team Admin lives under `/team/*` and is not covered here.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage();
  return (
    <div className="admin-shell">
      <AdminSubnav />
      {children}
    </div>
  );
}
