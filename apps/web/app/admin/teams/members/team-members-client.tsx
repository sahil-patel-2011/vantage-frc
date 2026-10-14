"use client";

import { useCallback, useEffect, useState } from "react";
import { PermissionsGrid, type GridEditable } from "../../../../components/permissions-grid";
import { Button, EmptyState, PageHeader, SoftBlockSkeleton } from "../../../../components/ui";
import type { GridChange, GridMember } from "../../../../lib/team/permissions-grid";
import { api } from "../../admin-console-kit";

type Payload = {
  team: { id: string; name: string; teamNumber: number | null };
  members: GridMember[];
  actorUserId: string;
};

/** The platform owner's view of one team: everyone's access, changed in one grid. */
export function PlatformTeamMembers({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await api<Payload>(`/api/admin/organizations/members?orgId=${encodeURIComponent(orgId)}`);
    if (!result.ok) {
      setError(result.error === "Not found" ? "This page is for the platform owner." : result.error);
      return;
    }
    setError("");
    setData(result.data);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  function canEdit(member: GridMember): GridEditable {
    if (member.userId === data?.actorUserId) return { ok: false, reason: "You. Change it on the team's Members and invites." };
    if (member.role === "owner") return { ok: false, reason: "Opens everything. Only the owner hands the team over." };
    return { ok: true };
  }

  async function save(member: GridMember, change: GridChange): Promise<string | null> {
    const result = await api("/api/admin/organizations/members", {
      method: "PATCH",
      body: JSON.stringify({
        orgId,
        userId: member.userId,
        role: change.role,
        capabilities: change.capabilities,
        hubAccess: change.hubAccess,
      }),
    });
    return result.ok ? null : result.error;
  }

  const title = data ? `#${data.team.teamNumber ?? "–"} · ${data.team.name}` : "Members and permissions";

  return (
    <main className="module-page admin-control ac-page">
      <PageHeader
        breadcrumbs="Platform admin › Teams"
        title={title}
        description="Members and permissions. Change anyone's access and which parts of the app they can open. They're told when their role changes."
      >
        <Button as="a" variant="secondary" href={`/admin/teams?team=${encodeURIComponent(orgId)}`}>
          Back to team
        </Button>
      </PageHeader>
      {error && !data ? (
        <EmptyState soft title="Can't open this team's members" description={error}>
          <Button variant="secondary" type="button" onClick={() => void load()}>
            Try again
          </Button>
        </EmptyState>
      ) : !data ? (
        <SoftBlockSkeleton />
      ) : (
        <PermissionsGrid
          members={data.members}
          canEdit={canEdit}
          canMakeMentor
          canGrantBilling
          onSave={save}
          onSaved={load}
        />
      )}
    </main>
  );
}
