// Drive shares: list, create (link or email), revoke.
//
// A share link works for someone with no Vantage account, because most of the
// people a team needs to hand a file to — a parent, a sponsor, a judge, a
// rookie team's mentor — will never have one. The token is 16 bytes of
// randomness, only its sha256 is stored, and the plaintext comes back exactly
// once here. "Resend the link" means "make a new share", not "look up the old
// token", and the UI says so.
//
// The share EMAIL is transactional, not marketing: the recipient did not opt
// in to Vantage and cannot have, because they may not have an account at all.
// So it does not go through resolve_opt_in_email_recipient (which would
// correctly refuse to send to a stranger) — it is sent directly with
// sendFreeform, and when Resend is not configured the response says
// setup_required and hands back the link for the sender to paste, rather than
// claiming an email went out.

import { createEmailProvider, isEmailProviderConfigured, resolveAuthBaseURL } from "@vantage/core";
import { withRls } from "@vantage/db";
import {
  DriveHttpError,
  driveErrorResponse,
  readString,
  readUuid,
  requireDriveMembership,
  requireDriveSession,
} from "../../../../lib/drive/api";
import { driveShareUrl, newDriveShareToken } from "../../../../lib/drive/share-token";
import { createShare, listShares, revokeShare } from "../../../../lib/drive/store";
import { parseShareEmails } from "../../../../lib/drive/validation";

export const dynamic = "force-dynamic";
// A share to a classroom's worth of parents is a bounded set of provider round
// trips, which is more than the default function budget allows for.
export const maxDuration = 60;

const MAX_EMAILS = 25;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function GET(request: Request) {
  try {
    const session = await requireDriveSession();
    const url = new URL(request.url);
    const requestedOrgId = readUuid(url.searchParams.get("orgId"));
    const fileId = readUuid(url.searchParams.get("fileId"));
    const includeRevoked = url.searchParams.get("includeRevoked") === "1";

    const shares = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);
        return listShares(client, { orgId, fileId, includeRevoked });
      },
    );
    return Response.json({ shares }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return driveErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireDriveSession();
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new DriveHttpError(400, "Invalid JSON body");
    }

    const requestedOrgId = readUuid(body.orgId);
    const fileId = readUuid(body.fileId);
    const folderId = readUuid(body.folderId);
    if ((fileId && folderId) || (!fileId && !folderId)) {
      throw new DriveHttpError(400, "Share exactly one thing: a fileId or a folderId.");
    }
    const canDownload = body.canDownload !== false;
    const note = readString(body.note, 2000);
    const { emails, rejected } = parseShareEmails(body.emails, MAX_EMAILS);

    let expiresAt: string | null = null;
    if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
      const ms = Date.parse(body.expiresAt);
      if (!Number.isFinite(ms)) throw new DriveHttpError(400, "expiresAt is not a date.");
      if (ms <= Date.now()) throw new DriveHttpError(400, "That expiry is already in the past.");
      expiresAt = new Date(ms).toISOString();
    }

    const baseUrl = resolveAuthBaseURL();

    const created = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId, orgName } = await requireDriveMembership(
          client,
          session.userId,
          requestedOrgId,
        );

        // The target's name, read under RLS: if this returns nothing, the
        // caller cannot see the thing they are trying to share, and the INSERT
        // policy would refuse anyway.
        const target = await client.query<{ name: string }>(
          fileId
            ? `SELECT name FROM drive_files WHERE id = $1::uuid AND org_id = $2::uuid AND deleted_at IS NULL`
            : `SELECT name FROM drive_folders WHERE id = $1::uuid AND org_id = $2::uuid`,
          [fileId ?? folderId, orgId],
        );
        const targetName = target.rows[0]?.name;
        if (!targetName) {
          throw new DriveHttpError(404, "That file or folder does not exist, or you cannot see it.");
        }

        const made: Array<{ id: string; kind: "link" | "email"; email: string | null; url: string }> = [];
        const targets: Array<{ kind: "link" | "email"; email: string | null }> =
          emails.length > 0
            ? emails.map((email) => ({ kind: "email" as const, email }))
            : [{ kind: "link" as const, email: null }];

        for (const entry of targets) {
          const token = newDriveShareToken();
          const row = await createShare(client, {
            orgId,
            userId: session.userId,
            fileId,
            folderId,
            kind: entry.kind,
            email: entry.email,
            note,
            canDownload,
            expiresAt,
            token,
          });
          if (!row) {
            throw new DriveHttpError(403, "That file or folder is not yours to share.");
          }
          made.push({ id: row.id, kind: entry.kind, email: entry.email, url: driveShareUrl(baseUrl, token) });
        }

        return { orgId, orgName, targetName, made };
      },
    );

    // Email delivery happens after the database work commits, so a provider
    // outage cannot roll back a share the sender can still copy by hand.
    const emailShares = created.made.filter((entry) => entry.kind === "email");
    let email: { status: "sent" | "setup_required" | "partial"; reason?: string; sent: number; failed: string[] } = {
      status: "sent",
      sent: 0,
      failed: [],
    };

    if (emailShares.length > 0) {
      if (!isEmailProviderConfigured()) {
        email = {
          status: "setup_required",
          reason:
            "Email delivery is not configured. The links below are live — copy them and send them yourself.",
          sent: 0,
          failed: [],
        };
      } else {
        const provider = createEmailProvider();
        const failed: string[] = [];
        let sent = 0;
        for (const entry of emailShares) {
          const subject = `${created.orgName} shared "${created.targetName}" with you`;
          const lines = [
            `${session.name || "Someone"} from ${created.orgName} shared "${created.targetName}" with you on Vantage.`,
            "",
            `Open it: ${entry.url}`,
            ...(note ? ["", `Their note: ${note}`] : []),
            ...(expiresAt ? ["", `This link stops working on ${new Date(expiresAt).toUTCString()}.`] : []),
            "",
            "You do not need a Vantage account to open this link. Anyone who has the link can open it, so please do not forward it.",
          ];
          const html = [
            `<p>${escapeHtml(session.name || "Someone")} from ${escapeHtml(created.orgName)} shared <strong>${escapeHtml(created.targetName)}</strong> with you on Vantage.</p>`,
            `<p><a href="${escapeHtml(entry.url)}">Open it</a></p>`,
            ...(note ? [`<p>Their note: ${escapeHtml(note)}</p>`] : []),
            ...(expiresAt
              ? [`<p>This link stops working on ${escapeHtml(new Date(expiresAt).toUTCString())}.</p>`]
              : []),
            `<p style="font-size:12px;color:#666">You do not need a Vantage account to open this link. Anyone who has the link can open it, so please do not forward it.</p>`,
          ].join("\n");
          try {
            await provider.sendFreeform({ to: entry.email!, subject, text: lines.join("\n"), html });
            sent += 1;
          } catch {
            failed.push(entry.email!);
          }
        }
        email = {
          status: failed.length === 0 ? "sent" : "partial",
          sent,
          failed,
          ...(failed.length > 0
            ? { reason: `Could not email ${failed.join(", ")}. The links are live — copy them and send them another way.` }
            : {}),
        };
      }
    }

    return Response.json({
      shares: created.made,
      email,
      // Say plainly what we could not do, rather than dropping it.
      rejectedAddresses: rejected,
    });
  } catch (error) {
    return driveErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireDriveSession();
    const url = new URL(request.url);
    const shareId = readUuid(url.searchParams.get("shareId"));
    if (!shareId) throw new DriveHttpError(400, "shareId is required");
    const requestedOrgId = readUuid(url.searchParams.get("orgId"));

    const revoked = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);
        return revokeShare(client, { orgId, shareId });
      },
    );
    if (!revoked) {
      throw new DriveHttpError(403, "That share is not yours to revoke, or it is already revoked.");
    }
    return Response.json({ ok: true });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
