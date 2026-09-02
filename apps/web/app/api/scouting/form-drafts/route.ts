// Scout form studio — server-side drafts (autosave / resume). Coach-gated end to end:
// GET lists the org's drafts, PUT upserts THE draft for (season, kind), DELETE discards it.
// Publishing is unchanged: it still goes through /api/scouting/schemas.
import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { scoutingErrorResponse, withScoutingRequest } from "../../../../lib/scouting-auth";
import {
  assertCoach,
  deleteFormDraft,
  isFormKind,
  isSeasonYear,
  loadFormDrafts,
  normalizeDraftDefinition,
  saveFormDraft,
} from "../../../../lib/scouting/form-studio";

export const dynamic = "force-dynamic";

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const yearRaw = url.searchParams.get("seasonYear");
    const seasonYear = yearRaw ? Number(yearRaw) : null;
    const kindRaw = url.searchParams.get("formKind");
    if (seasonYear != null && !isSeasonYear(seasonYear)) {
      return Response.json({ error: "seasonYear is out of range" }, { status: 400 });
    }
    if (kindRaw && !isFormKind(kindRaw)) {
      return Response.json({ error: "formKind must be match or pit" }, { status: 400 });
    }
    const drafts = await withScoutingRequest(orgId, async (client) => {
      await assertCoach(client, orgId!);
      return loadFormDrafts(client, { orgId: orgId!, seasonYear, formKind: kindRaw && isFormKind(kindRaw) ? kindRaw : null });
    });
    return Response.json({ drafts }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = typeof body.orgId === "string" ? body.orgId : null;
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    if (!isFormKind(body.formKind)) return Response.json({ error: "formKind must be match or pit" }, { status: 400 });
    if (!isSeasonYear(body.seasonYear)) return Response.json({ error: "seasonYear is out of range" }, { status: 400 });
    const definition = normalizeDraftDefinition(body.definition);
    if (!definition) return Response.json({ error: "Invalid draft definition" }, { status: 400 });
    const title = typeof body.title === "string" ? body.title : definition.title;
    const baseSchemaId = uuidOrNull(body.baseSchemaId);
    const formKind = body.formKind;
    const seasonYear = body.seasonYear;
    const draft = await withScoutingRequest(orgId, async (client) => {
      await assertCoach(client, orgId);
      return saveFormDraft(client, {
        orgId,
        userId: session.user.id,
        formKind,
        seasonYear,
        title,
        definition,
        baseSchemaId,
      });
    });
    return Response.json({ draft }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = typeof body.orgId === "string" ? body.orgId : null;
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    if (!isFormKind(body.formKind)) return Response.json({ error: "formKind must be match or pit" }, { status: 400 });
    if (!isSeasonYear(body.seasonYear)) return Response.json({ error: "seasonYear is out of range" }, { status: 400 });
    const formKind = body.formKind;
    const seasonYear = body.seasonYear;
    const deleted = await withScoutingRequest(orgId, async (client) => {
      await assertCoach(client, orgId);
      return deleteFormDraft(client, { orgId, formKind, seasonYear });
    });
    return Response.json({ deleted }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
