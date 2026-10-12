import AdminClient from "../admin-client";
import { TeamGovernance } from "./team-governance";

export const metadata = {
  title: "Teams · Platform admin",
};

export const dynamic = "force-dynamic";

/**
 * Every team; each opens a panel with its owner invite, AI credit and delete. Team requests and
 * banned teams sit above the list.
 */
export default function AdminTeamsPage() {
  return (
    <AdminClient>
      <TeamGovernance />
    </AdminClient>
  );
}
