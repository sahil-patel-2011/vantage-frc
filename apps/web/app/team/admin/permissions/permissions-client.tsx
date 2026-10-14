"use client";

import { useCallback, useEffect, useState } from "react";
import { PermissionsGrid, type GridEditable } from "../../../../components/permissions-grid";
import { Button, EmptyState } from "../../../../components/ui";
import { withOrgHref } from "../../../../lib/nav/product-nav";
import type { GridChange, GridMember } from "../../../../lib/team/permissions-grid";

type MembersResponse = {
  members?: Array<{ userId: string; name: string; email: string; role: string; capabilities?: string[] }>;
  hubAccessByUser?: Record<string, Array<{ hubId: string; allowedTabIds: string[] }>>;
  actorRole?: string | null;
  actorUserId?: string | null;
  error?: string;
};

/** The same members API Team admin's Access window uses, so the same checks decide. */
async function patchMember(orgId: string, body: Record<string, unknown>): Promise<string | null> {
  const response = await fetch("/api/organizations/members", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orgId, ...body }),
  });
  if (response.ok) return null;
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "That didn't save. Try again.";
}

export function TeamPermissionsClient({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<GridMember[] | null>(null);
  const [actor, setActor] = useState<{ userId: string | null; role: string | null }>({ userId: null, role: null });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/organizations/members?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as MembersResponse;
      if (!response.ok) {
        setError(data.error ?? "Could not load the team's people.");
        return;
      }
      setError("");
      setActor({ userId: data.actorUserId ?? null, role: data.actorRole ?? null });
      setMembers(
        (data.members ?? []).map((member) => ({
          userId: member.userId,
          name: member.name,
          email: member.email,
          role: member.role,
          capabilities: member.capabilities ?? [],
          hubAccess: data.hubAccessByUser?.[member.userId] ?? [],
        })),
      );
    } catch {
      setError("No connection. Check your internet and try again.");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  function canEdit(member: GridMember): GridEditable {
    if (member.userId === actor.userId) return { ok: false, reason: "You. Change it from Members and invites." };
    if (member.role === "owner") return { ok: false, reason: "Opens everything." };
    if (member.role === "admin" && actor.role !== "owner") return { ok: false, reason: "Only the owner changes a mentor." };
    return { ok: true };
  }

  // Role first, then powers (which also clears a scouting lead before Competition is limited),
  // then sections: the order Team admin's Access window saves in.
  async function save(member: GridMember, change: GridChange): Promise<string | null> {
    if (change.changed.role) {
      const failure = await patchMember(orgId, { userId: member.userId, action: "set_role", role: change.role });
      if (failure) return failure;
    }
    if (change.changed.capabilities) {
      const failure = await patchMember(orgId, {
        userId: member.userId,
        action: "set_capabilities",
        capabilities: change.capabilities,
      });
      if (failure) return failure;
    }
    if (change.changed.hubAccess) {
      const failure = await patchMember(orgId, { userId: member.userId, action: "set_hub_access", hubAccess: change.hubAccess });
      if (failure) return failure;
    }
    return null;
  }

  return (
    <>
      <nav className="team-admin-settings-links" aria-label="Related">
        <a href={withOrgHref("/team/admin", orgId)}>Members and invites</a>
        <a href={withOrgHref("/team/admin/presets", orgId)}>Custom roles</a>
      </nav>
      {error && !members ? (
        <EmptyState soft badge="Unavailable" badgeTone="setup" title="Couldn't load the team" description={error}>
          <Button variant="secondary" type="button" onClick={() => void load()}>
            Retry
          </Button>
        </EmptyState>
      ) : !members ? (
        <EmptyState soft title="Loading the team…" description="Getting everyone's access." aria-busy />
      ) : (
        <PermissionsGrid
          members={members}
          canEdit={canEdit}
          canMakeMentor={actor.role === "owner"}
          canGrantBilling={actor.role === "owner"}
          onSave={save}
          onSaved={load}
        />
      )}
    </>
  );
}
