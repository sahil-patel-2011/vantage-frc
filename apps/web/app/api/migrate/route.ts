import { currentSeasonYear } from "@vantage/game-year";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { ImportShapeError } from "@vantage/import";
import {
  commitHoursCsv,
  commitIcsDrafts,
  commitInviteDrafts,
  commitNotionJson,
  commitPurpleStandard,
  commitQrScoutEntries,
  commitScoutCsv,
  commitScoutradioz,
  commitTrelloBoard,
  computeMigrateView,
  deleteImportPreset,
  fetchAndCommitIcsUrl,
  listImportPresets,
  previewCsvHeaders,
  previewCsvMapping,
  previewIcs,
  previewNotionJson,
  previewPurpleStandard,
  previewQrScoutEntries,
  previewQrScoutForm,
  previewScoutradioz,
  previewStimsRoster,
  previewTrelloCards,
  previewTrelloLists,
  saveImportPreset,
  upsertIcsConnection,
  type MigrateView,
} from "../../../lib/migrate/compute-migrate";
import type { ColumnGuess } from "@vantage/import";
import type { OrgRole } from "@vantage/core";

const INVITABLE_ROLES: OrgRole[] = ["admin", "scout", "viewer"];

function readString(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === "string" ? (body[key] as string) : "";
}

function readColumnMap(raw: unknown): Record<string, ColumnGuess> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const allowed = new Set<ColumnGuess>([
    "event_key",
    "match_key",
    "team_key",
    "hours",
    "person",
    "date",
    "ignore",
  ]);
  const map: Record<string, ColumnGuess> = {};
  for (const [header, target] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof target === "string" && allowed.has(target as ColumnGuess)) {
      map[header] = target as ColumnGuess;
    }
  }
  return map;
}

const FALLBACK: MigrateView = {
  status: "setup_required",
  message: "Could not load the switching kit. Choose your team first.",
  steps: [{ id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" }],
  orgId: null,
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const requestedOrg = new URL(request.url).searchParams.get("orgId");
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMigrateView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(FALLBACK);
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  if (action === "preview-ics") {
    const content = typeof body.content === "string" ? body.content : "";
    return Response.json({ drafts: previewIcs(content) });
  }
  if (action === "preview-csv") {
    const content = typeof body.content === "string" ? body.content : "";
    return Response.json(previewCsvHeaders(content));
  }
  if (action === "preview-notion") {
    const content = typeof body.content === "string" ? body.content : "";
    try {
      return Response.json({ drafts: previewNotionJson(content) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Notion JSON";
      return Response.json({ error: message }, { status: 400 });
    }
  }

  /**
   * Parse-only previews. These touch no database and write nothing, so they run
   * outside the RLS block — but a bad file must still come back as a named
   * rejection rather than a 500, which is what `ImportShapeError` carries.
   */
  const PARSE_ONLY: Record<string, () => unknown> = {
    "preview-purple-standard": () =>
      previewPurpleStandard(readString(body, "content"), readString(body, "eventKey") || undefined),
    "preview-qrscout-form": () =>
      previewQrScoutForm(
        readString(body, "content"),
        readString(body, "entryType") === "pit" ? "pit" : "match",
      ),
    "preview-qrscout-entries": () =>
      previewQrScoutEntries({
        configContent: readString(body, "configContent"),
        payloadContent: readString(body, "payloadContent"),
        eventKey: readString(body, "eventKey"),
      }),
    "preview-scoutradioz": () =>
      previewScoutradioz(readString(body, "content"), readString(body, "eventKey") || undefined),
    "preview-trello-lists": () => previewTrelloLists(readString(body, "content")),
    "preview-trello-cards": () =>
      previewTrelloCards({
        content: readString(body, "content"),
        listStatus: body.listStatus,
        includeClosed: body.includeClosed === true,
      }),
    "preview-stims": () => previewStimsRoster(readString(body, "content")),
  };
  const parseOnly = PARSE_ONLY[action];
  if (parseOnly) {
    try {
      return Response.json(parseOnly());
    } catch (error) {
      if (error instanceof ImportShapeError) {
        return Response.json({ error: error.message, expected: error.expected }, { status: 400 });
      }
      const message = error instanceof Error ? error.message : "That file could not be read";
      return Response.json({ error: message }, { status: 400 });
    }
  }

  try {
    const extra: Record<string, unknown> = {};
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query<{ role: string }>(
        `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, session.user.id],
      );
      const role = member.rows[0]?.role;
      if (role !== "owner" && role !== "admin") throw new Error("forbidden");
      const seasonYear = currentSeasonYear();

      if (action === "connect-ics") {
        const icsUrl = typeof body.icsUrl === "string" ? body.icsUrl : "";
        await upsertIcsConnection(client, {
          orgId,
          userId: session.user.id,
          icsUrl,
          label: typeof body.label === "string" ? body.label : undefined,
        });
      }
      if (action === "sync-ics") {
        const icsUrl = typeof body.icsUrl === "string" ? body.icsUrl : "";
        extra.written = await fetchAndCommitIcsUrl(client, {
          orgId,
          userId: session.user.id,
          icsUrl,
        });
      }
      if (action === "commit-ics") {
        const content = typeof body.content === "string" ? body.content : "";
        extra.written = await commitIcsDrafts(client, {
          orgId,
          userId: session.user.id,
          drafts: previewIcs(content),
        });
      }
      if (action === "commit-hours-csv") {
        extra.written = await commitHoursCsv(client, {
          orgId,
          userId: session.user.id,
          content: typeof body.content === "string" ? body.content : "",
          seasonYear,
        });
      }
      if (action === "commit-scout-csv") {
        extra.written = await commitScoutCsv(client, {
          orgId,
          userId: session.user.id,
          content: typeof body.content === "string" ? body.content : "",
        });
      }
      if (action === "commit-notion") {
        extra.counts = await commitNotionJson(client, {
          orgId,
          userId: session.user.id,
          content: typeof body.content === "string" ? body.content : "",
          seasonYear,
        });
      }
      if (action === "commit-purple-standard") {
        extra.report = await commitPurpleStandard(client, {
          orgId,
          userId: session.user.id,
          content: readString(body, "content"),
          eventKey: readString(body, "eventKey") || undefined,
        });
      }
      if (action === "commit-qrscout-entries") {
        extra.report = await commitQrScoutEntries(client, {
          orgId,
          userId: session.user.id,
          configContent: readString(body, "configContent"),
          payloadContent: readString(body, "payloadContent"),
          eventKey: readString(body, "eventKey"),
        });
      }
      if (action === "commit-scoutradioz") {
        extra.report = await commitScoutradioz(client, {
          orgId,
          userId: session.user.id,
          content: readString(body, "content"),
          eventKey: readString(body, "eventKey") || undefined,
        });
      }
      if (action === "commit-trello") {
        extra.report = await commitTrelloBoard(client, {
          orgId,
          userId: session.user.id,
          content: readString(body, "content"),
          listStatus: body.listStatus,
          includeClosed: body.includeClosed === true,
          seasonYear,
        });
      }
      if (action === "commit-invites") {
        // Only the addresses the owner ticked in the review step are sent, and
        // only through the existing invite machinery.
        const emails = Array.isArray(body.emails)
          ? body.emails.filter((value): value is string => typeof value === "string")
          : [];
        if (!emails.length) throw new Error("Select at least one person to invite");
        const requestedRole = readString(body, "role") as OrgRole;
        const role = INVITABLE_ROLES.includes(requestedRole) ? requestedRole : "scout";
        extra.invites = await commitInviteDrafts(client, {
          orgId,
          userId: session.user.id,
          emails,
          role,
          sendEmail: body.sendEmail === true,
        });
      }
      if (action === "preview-csv-mapping") {
        extra.mapping = await previewCsvMapping(client, {
          orgId,
          content: readString(body, "content"),
          connector: readString(body, "connector") || "scout",
          presetId: readString(body, "presetId") || undefined,
        });
      }
      if (action === "list-presets") {
        extra.presets = await listImportPresets(client, {
          orgId,
          connector: readString(body, "connector") || undefined,
        });
      }
      if (action === "save-preset") {
        extra.preset = await saveImportPreset(client, {
          orgId,
          userId: session.user.id,
          connector: readString(body, "connector") || "scout",
          name: readString(body, "name"),
          columns: readColumnMap(body.columns),
        });
      }
      if (action === "delete-preset") {
        extra.removed = await deleteImportPreset(client, {
          orgId,
          presetId: readString(body, "presetId"),
        });
      }
      return computeMigrateView(client, { userId: session.user.id, requestedOrg: orgId });
    });
    return Response.json({ ...view, ...extra });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save import";
    if (message === "forbidden") return Response.json({ error: "Forbidden" }, { status: 403 });
    if (error instanceof ImportShapeError) {
      return Response.json({ error: message, expected: error.expected }, { status: 400 });
    }
    return Response.json({ error: message }, { status: 400 });
  }
}
