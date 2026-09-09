/**
 * DOC EDITING ROLES — who may create and edit the team's docs.
 *
 * The docs in question are `knowledge_pages` (0149_team_wiki.sql), the team
 * playbook behind /knowledge. Until 0621 any member could write one. Now
 * writing is `has_org_capability(org_id, 'edit_docs')`, and this is the grant
 * path.
 *
 * THE OWNER-ONLY RULE, precisely:
 *  - Owners and admins edit docs without a grant. They run the team, and the
 *    automated publish paths (exit-interview handoffs, approved
 *    knowledge-capture drafts, the Notion/Sheets importer) are already gated to
 *    them — narrowing those would have broken publishing, silently.
 *  - Everyone else needs an explicit `edit_docs` grant, and ONLY the org owner
 *    (or the platform admin who provisioned the team) can issue one. That is
 *    `membership_capabilities_doc_write` in RLS, not a check in this file.
 *  - Nobody can grant it to themselves. The RLS WITH CHECK and the
 *    `membership_capabilities_no_self_grant` table constraint both refuse a row
 *    where the grantee is the granter, so no ordering of API calls gets you the
 *    role you were not given.
 *
 * This module reads the roster and reports it. It never decides anything the
 * database would not also decide.
 */

import type { PoolClient } from "@neondatabase/serverless";
import {
  canEditDocs,
  grantableMembers,
  implicitHolders,
  listCapabilityGrants,
  type CapabilityGrant,
  type OrgRole,
} from "../capabilities/org-capabilities";

export type DocRoleMember = {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
};

export type DocRolesView =
  | { status: "setup_required"; message: string; orgId: string | null }
  | {
      status: "ready";
      orgId: string;
      orgName: string;
      /** The signed-in person's org role, so the copy can be specific. */
      role: OrgRole;
      /** Can this person edit docs right now? */
      canEditDocs: boolean;
      /** Can this person hand the role out? Owner only. */
      canGrant: boolean;
      /** Why not, in one sentence, when canGrant is false. */
      cannotGrantReason: string | null;
      /** Explicitly granted editors. */
      editors: CapabilityGrant[];
      /**
       * Owners and admins, who edit without a grant. Listed so an empty
       * `editors` table never reads as "nobody can edit the playbook".
       */
      implicitEditors: DocRoleMember[];
      /** Members the role could be granted to. */
      candidates: DocRoleMember[];
      computedAt: string;
    };

function missingTable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return code === "42P01" || code === "42703" || code === "42883" || code === "22P02";
}

export async function computeDocRolesView(
  client: PoolClient,
  input: { orgId: string; orgName: string; role: OrgRole },
): Promise<DocRolesView> {
  const { orgId } = input;

  try {
    const platformAdmin = await client.query<{ allowed: boolean }>(
      `SELECT is_platform_admin() AS allowed`,
    );
    const isPlatformAdmin = platformAdmin.rows[0]?.allowed === true;
    const canGrant = input.role === "owner" || isPlatformAdmin;

    const [editors, candidates, leaders, editable] = await Promise.all([
      listCapabilityGrants(client, orgId, "edit_docs"),
      grantableMembers(client, orgId, "edit_docs"),
      implicitHolders(client, orgId),
      canEditDocs(client, orgId),
    ]);

    return {
      status: "ready",
      orgId,
      orgName: input.orgName,
      role: input.role,
      canEditDocs: editable,
      canGrant,
      cannotGrantReason: canGrant
        ? null
        : input.role === "admin"
          ? "Only the team owner can grant doc editing. Admins can edit docs themselves, but cannot hand the role to anyone else."
          : "Only the team owner can grant doc editing.",
      editors,
      implicitEditors: leaders,
      candidates,
      computedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (missingTable(error)) {
      return {
        status: "setup_required",
        message: "Doc role migrations have not been applied yet. Run npm run db:migrate, then reload.",
        orgId,
      };
    }
    throw error;
  }
}
