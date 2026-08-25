import { createHash, randomUUID } from "node:crypto";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter } from "@vantage/agent";
import { createBridgeTransport } from "../../../../lib/ai-bridge/transport";
import { meteredAI } from "@vantage/billing";
import { withRls } from "@vantage/db";
import {
  buildExplainPrompt,
  isExplainLevel,
  type ExplainLevel,
  type Narration,
  type NarrationStatus,
} from "../../../../lib/agent-narration/narration";
import { failMeteredAi } from "../../../../lib/metered-ai-fail";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { requireOrgMember, requireTenantSession, TenantHttpError } from "../../../../lib/tenant-org-access";

/**
 * "Explain this differently" — re-renders ONE recorded narration step at a chosen level.
 *
 * Grounded strictly in that step's data (see buildExplainPrompt): the prompt states outright when
 * no reason was recorded, and forbids guessing intent. Metered as feature="explain_step".
 */

/**
 * This route reaches a real upstream model. A bridged turn (a paired device with
 * coverage 'everything') holds the request open for the bridge poll budget
 * (BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS, 240s), so this function declares 300s to keep
 * headroom above it; the adapter's own timeout still fires first and returns a
 * classified error instead of the platform killing the function mid-request.
 *
 * 300s is only honored where the hosting plan's Node function cap reaches it. Below
 * that cap set VANTAGE_BRIDGE_MAX_WAIT_MS so the turn falls through to the team's own
 * keys instead of 504-ing — see docs/AI_BRIDGE.md "Function duration".
 */
export const maxDuration = 300;

const limiter = createRateLimiter({ limit: 12, windowMs: 60_000, namespace: "explain-step" });

/** Trivial in-process cache: the same step at the same level never changes, so never bill twice. */
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 200;
const cache = new Map<string, { text: string; expiresAt: number }>();

function cacheGet(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.text;
}

function cacheSet(key: string, text: string) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { text, expiresAt: Date.now() + CACHE_TTL_MS });
}

const STATUSES: NarrationStatus[] = ["ok", "empty", "setup_required", "error", "pending"];

function clamp(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

/** Rebuild a bounded Narration from the request body — never trust client field sizes. */
function sanitize(input: unknown): Narration | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const action = clamp(raw.action, 240);
  if (!action) return null;
  const stepNumber = typeof raw.step === "number" && Number.isFinite(raw.step) ? Math.trunc(raw.step) : 1;
  const status = STATUSES.includes(raw.status as NarrationStatus) ? (raw.status as NarrationStatus) : "ok";
  const narration: Narration = {
    step: Math.min(Math.max(stepNumber, 1), 999),
    action,
    status,
    origin:
      raw.origin === "code_finding" || raw.origin === "agent_step" ? raw.origin : "tool_call",
    key: clamp(raw.key, 160) ?? `step:${stepNumber}`,
  };
  const outcome = clamp(raw.outcome, 400);
  if (outcome) narration.outcome = outcome;
  const why = clamp(raw.why, 400);
  if (why) narration.why = why;
  const principle = clamp(raw.principle, 400);
  if (principle) narration.principle = principle;
  if (Array.isArray(raw.sources)) {
    const sources = raw.sources
      .slice(0, 4)
      .map((entry) => {
        const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
        const label = clamp(record.label, 200);
        if (!label) return null;
        const url = clamp(record.url, 400);
        const excerpt = clamp(record.excerpt, 600);
        return {
          label,
          ...(url && /^https?:\/\//i.test(url) ? { url } : {}),
          ...(excerpt ? { excerpt } : {}),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (sources.length) narration.sources = sources;
  }
  return narration;
}

export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = (await request.json()) as {
      orgId?: string;
      level?: string;
      narration?: unknown;
    };

    const orgId = body.orgId?.trim();
    if (!orgId) throw new TenantHttpError(400, "orgId is required");
    const level: ExplainLevel = isExplainLevel(body.level) ? body.level : "new";
    const narration = sanitize(body.narration);
    if (!narration) throw new TenantHttpError(400, "A recorded narration step is required");

    if (!(await limiter.allow(session.user.id))) {
      return rateLimitedResponse("Give the explanation a moment — try again shortly.");
    }

    const prompt = buildExplainPrompt(narration, level);
    const cacheKey = createHash("sha256").update(`${orgId}:${level}:${prompt}`).digest("hex");
    const cached = cacheGet(cacheKey);
    if (cached) {
      return Response.json({ text: cached, level, cached: true, feature: "explain_step" });
    }

    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, session.user.id);
      const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
      const adapter = await resolveOrgChatAdapter(client, {
        orgId,
        userId: session.user.id,
        promptCachingEnabled,
        feature: "explain_step",
        bridgeTransport: createBridgeTransport(),
      });
      const text = await meteredAI({
        client,
        orgId,
        userId: session.user.id,
        feature: "explain_step",
        requestId: randomUUID(),
        estimatedCostUsd: 0.004,
        estimatedPromptTokens: Math.ceil(prompt.length / 4),
        estimatedCompletionTokens: 220,
        provider: adapter.provider,
        model: adapter.model,
        metadata: {
          action: "explain_step",
          level,
          narrationKey: narration.key,
          origin: narration.origin,
          hadRecordedReason: Boolean(narration.why),
          ledgerTag: `explain_step:${orgId.slice(0, 8)}`,
        },
        invoke: async () => {
          const completion = await adapter.complete({
            message: prompt,
            context: [],
            promptCachingEnabled,
          });
          return {
            value: completion.text,
            promptTokens: completion.promptTokens,
            completionTokens: completion.completionTokens,
            costUsd: completion.costUsd,
            model: adapter.model,
            provider: adapter.provider,
            cacheReadInputTokens: completion.cacheReadInputTokens,
            cacheWriteInputTokens: completion.cacheWriteInputTokens,
            uncachedInputTokens: completion.uncachedInputTokens,
          };
        },
      });
      return { text: text.trim(), provider: adapter.provider, model: adapter.model };
    });

    if (!result.text) {
      return Response.json(
        { error: "The model returned nothing for this step.", code: "empty" },
        { status: 502 },
      );
    }
    cacheSet(cacheKey, result.text);
    return Response.json({
      text: result.text,
      level,
      cached: false,
      feature: "explain_step",
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    if (error instanceof TenantHttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return failMeteredAi(error, "Could not re-explain this step");
  }
}
