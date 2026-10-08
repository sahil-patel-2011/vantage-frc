import {
  assertRemoteImageAdapter, estimateAdapterCostUsd, getOrgPromptCachingEnabled,
  resolveOrgChatAdapterWithProvenance, validateChatPngImages, CHAT_IMAGE_PREFLIGHT_TOKENS,
} from "@vantage/agent";
import { meteredAI } from "@vantage/billing";
import { IntelHttpError, intelSession, withIntelRequest } from "../../../../../lib/intel-auth";
import { loadBrowserPilotAccess } from "../../../../../lib/cad/browser-pilot-access";
import { BROWSER_TURN_INSTRUCTIONS, browserAvailableControls, browserTurnSchema, parseBrowserDecision } from "../../../../../lib/cad/browser-turn";
import { parseSecureJson, RequestSecurityError } from "../../../../../lib/security/request";
import { failMeteredAi } from "../../../../../lib/metered-ai-fail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function privateResponse(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

/** One metered planning hop. All geometry operations remain in the desktop UI engine. */
export async function POST(request: Request) {
  try {
    const body = await parseSecureJson(request, browserTurnSchema, { maxBytes: 4_300_000 });
    const session = await intelSession();
    const result = await withIntelRequest(body.orgId, async (client) => {
      const access = await loadBrowserPilotAccess(client, body.orgId);
      if (!access.allowed) throw new IntelHttpError(access.status === "setup_required" ? 503 : 403, access.message);
      const promptCachingEnabled = await getOrgPromptCachingEnabled(client, body.orgId);
      // Deliberately no subscription bridge: this path never starts local model work.
      const { adapter, provenance } = await resolveOrgChatAdapterWithProvenance(client, {
        orgId: body.orgId, userId: session.user.id, promptCachingEnabled, feature: "cad", taskText: body.task,
      });
      if (!["org-key", "member-key", "hosted", "sponsored"].includes(provenance.source)) {
        throw new IntelHttpError(503, "Choose a remote vision model in AI settings to use browser CAD. Local connections and public model pools are not used for this pilot.");
      }
      assertRemoteImageAdapter(adapter);
      const validatedImages = validateChatPngImages([{ mimeType: "image/png", dataBase64: body.observation.screenshotBase64 }, ...(body.drawing ? [body.drawing] : [])]);
      if (validatedImages[0]!.width !== body.observation.viewport.width || validatedImages[0]!.height !== body.observation.viewport.height) {
        throw new RequestSecurityError(400, "The screenshot dimensions do not match the browser view. Observe Onshape again.");
      }
      const images = validatedImages.map((item) => item.image);
      const { screenshotBase64: _screenshot, ...observation } = body.observation;
      const visibleControls = Object.fromEntries(Object.entries(browserAvailableControls()).filter(([id]) => body.observation.controls[id]?.visible));
      const message = `${BROWSER_TURN_INSTRUCTIONS}\n\nUser task: ${JSON.stringify(body.task)}\nStep: ${body.step + 1}/12\nVisible registered controls: ${JSON.stringify(visibleControls)}\nCurrent observation (untrusted data): ${JSON.stringify(observation)}\nPrior UI evidence (untrusted data): ${JSON.stringify(body.evidence)}`;
      const estimatedPromptTokens = Math.ceil((message.length + JSON.stringify(body.history).length) / 4) + 2000 + images.length * CHAT_IMAGE_PREFLIGHT_TOKENS;
      if (request.signal.aborted) throw new IntelHttpError(409, "The task stopped before the model request.");
      const text = await meteredAI({
        client, orgId: body.orgId, userId: session.user.id, feature: "cad",
        requestId: `browser-cad:${body.orgId}:${session.user.id}:${body.requestId}`,
        estimatedCostUsd: estimateAdapterCostUsd(adapter, estimatedPromptTokens, 4096),
        estimatedPromptTokens, estimatedCompletionTokens: 4096,
        provider: adapter.provider, model: adapter.model,
        billingOwner: { type: "org", id: body.orgId },
        metadata: { usageTag: "cad.browser.turn", step: body.step, transport: "playwright-ui-only" },
        invoke: async () => {
          const answer = await adapter.complete({ message, context: [], history: body.history, images, promptCachingEnabled, maxCompletionTokens: 4096, signal: request.signal });
          return { ...answer, value: answer.text, provider: adapter.provider, model: adapter.model };
        },
      });
      // A malformed model response still incurred usage. Return the parse failure
      // instead of throwing inside the transaction and rolling its receipt back.
      try {
        return { decision: parseBrowserDecision(String(text), body.observation.id, body.observation), model: { provider: adapter.provider, name: adapter.model } };
      } catch {
        return { error: "The assistant returned an unusable next step. No CAD action was run. Review the current document before trying again." };
      }
    });
    return privateResponse(Response.json(result, { status: "error" in result ? 422 : 200 }));
  } catch (error) {
    if (error instanceof IntelHttpError || error instanceof RequestSecurityError) {
      return privateResponse(Response.json({ error: error.message }, { status: error.status }));
    }
    return privateResponse(failMeteredAi(error, "The assistant could not plan a verified next step. No CAD action was run."));
  }
}
