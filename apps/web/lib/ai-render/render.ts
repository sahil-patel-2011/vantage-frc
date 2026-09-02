/**
 * apps/web binding for renderWithModel (packages/agent/src/render.ts).
 *
 * Every "AI-led" feature in lib/<feature>/compute-*.ts calls one of these instead of
 * wrapping its deterministic template in meteredAI with keySource 'local_cli'. The org's
 * real adapter is resolved exactly as chat resolves it (org/member keys, hosted, sponsored,
 * a covering paired subscription bridge), the call is metered under the feature's own name
 * with a real cost estimate, and on any failure the template stands in with a recorded
 * reason. The returned `render.mode` must reach the route's JSON and the UI badge.
 */

import type { PoolClient } from "@neondatabase/serverless";
import {
  getOrgPromptCachingEnabled,
  renderStructuredWithModel,
  renderWithModel,
  type RenderOutcome,
  type RenderStructuredInput,
  type RenderWithModelInput,
  type RenderWithModelResult,
} from "@vantage/agent";
import { createBridgeTransport } from "../ai-bridge/transport";

export type { RenderOutcome } from "@vantage/agent";
export { recordTemplateOnlyRender, renderOutcomeOf } from "@vantage/agent";

type Bound<T> = Omit<T, "bridgeTransport" | "promptCachingEnabled" | "resolveAdapter" | "metered">;

async function promptCaching(client: PoolClient, orgId: string): Promise<boolean> {
  try {
    return await getOrgPromptCachingEnabled(client, orgId);
  } catch {
    return true;
  }
}

/** Free-text render: `template()` is the deterministic fallback; `text` is what to persist. */
export async function renderFeatureText(
  input: Bound<RenderWithModelInput>,
): Promise<RenderWithModelResult> {
  return renderWithModel({
    ...input,
    promptCachingEnabled: await promptCaching(input.client, input.orgId),
    bridgeTransport: createBridgeTransport(),
  });
}

/**
 * Structured render: the deterministic value goes to the model as JSON and only the
 * named prose fields may come back rewritten; numbers, enums and ids are guaranteed to
 * be the template's (anything else is rejected and the template stands).
 */
export async function renderFeatureValue<T>(
  input: Bound<RenderStructuredInput<T>>,
): Promise<{ value: T; render: RenderOutcome }> {
  return renderStructuredWithModel({
    ...input,
    promptCachingEnabled: await promptCaching(input.client, input.orgId),
    bridgeTransport: createBridgeTransport(),
  });
}

/** Compact, deterministic serialization of the inputs a template used — for prompts. */
export function factsBlock(facts: Record<string, unknown>): string {
  return Object.entries(facts)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}
