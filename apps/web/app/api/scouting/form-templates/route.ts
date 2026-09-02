// Scout form studio — templates. GET lists the org's saved templates plus the built-in
// starters from packages/game-year; POST saves the current draft as a template or applies
// a template / starter into THE draft for the active season; DELETE removes a saved one.
import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { scoutingErrorResponse, withScoutingRequest } from "../../../../lib/scouting-auth";
import {
  assertCoach,
  deleteFormTemplate,
  isFormKind,
  isSeasonYear,
  loadFormTemplate,
  loadFormTemplates,
  normalizeDraftDefinition,
  resolveStudioYear,
  saveFormDraft,
  saveFormTemplate,
  starterById,
  starterTemplates,
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
    const orgId = new URL(request.url).searchParams.get("orgId");
    const data = await withScoutingRequest(orgId, async (client) => {
      const studio = await resolveStudioYear(client, orgId!);
      const templates = await loadFormTemplates(client, orgId!);
      return {
        activeYear: studio.year,
        yearSource: studio.yearSource,
        templates,
        starters: starterTemplates(studio.year),
      };
    });
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = typeof body.orgId === "string" ? body.orgId : null;
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const action = typeof body.action === "string" ? body.action : "";
    if (!isFormKind(body.formKind)) return Response.json({ error: "formKind must be match or pit" }, { status: 400 });
    const formKind = body.formKind;

    if (action === "save") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return Response.json({ error: "Give the template a name" }, { status: 400 });
      const definition = normalizeDraftDefinition(body.definition);
      if (!definition || !definition.fields.length) {
        return Response.json({ error: "A template needs at least one field" }, { status: 400 });
      }
      const sourceYear = isSeasonYear(body.sourceYear) ? body.sourceYear : null;
      const description = typeof body.description === "string" ? body.description : "";
      const template = await withScoutingRequest(orgId, async (client) => {
        await assertCoach(client, orgId);
        return saveFormTemplate(client, {
          orgId,
          userId: session.user.id,
          name,
          description,
          formKind,
          sourceYear,
          definition,
        });
      });
      return Response.json({ template }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }

    if (action === "apply") {
      const templateId = uuidOrNull(body.templateId);
      const starterId = typeof body.starterId === "string" ? body.starterId : null;
      if (!templateId && !starterId) {
        return Response.json({ error: "templateId or starterId is required" }, { status: 400 });
      }
      const result = await withScoutingRequest(orgId, async (client) => {
        await assertCoach(client, orgId);
        const studio = await resolveStudioYear(client, orgId);
        const seasonYear = isSeasonYear(body.seasonYear) ? body.seasonYear : studio.year;
        const source = templateId
          ? await loadFormTemplate(client, { orgId, templateId })
          : starterById(studio.year, starterId!);
        if (!source) throw new Error("Template not found");
        if (source.formKind !== formKind) throw new Error(`That template is a ${source.formKind} form`);
        const draft = await saveFormDraft(client, {
          orgId,
          userId: session.user.id,
          formKind,
          seasonYear,
          title: source.definition.title || source.name,
          definition: source.definition,
        });
        return { draft, source: { id: source.id, name: source.name, builtIn: source.builtIn } };
      });
      return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
    }

    return Response.json({ error: "Unsupported template action" }, { status: 400 });
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
    const templateId = uuidOrNull(body.templateId);
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    if (!templateId) return Response.json({ error: "templateId is required" }, { status: 400 });
    const deleted = await withScoutingRequest(orgId, async (client) => {
      await assertCoach(client, orgId);
      return deleteFormTemplate(client, { orgId, templateId });
    });
    return Response.json({ deleted }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
