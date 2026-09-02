/**
 * Cross-team isolation for the shared FreeBuff box.
 *
 * The Pi holds one FreeBuff session for the whole deployment. Isolation is not a
 * property of that session — it is a property of what Vantage sends. Every
 * completion that leaves this process for the relay is tagged with exactly one
 * org id, and any context item that names a different org is dropped rather than
 * forwarded. History is the caller's problem (loaders already filter by org_id);
 * this module only refuses to be the leak.
 */

import type { ChatAdapter, ChatCompletionResult, ContextItem } from "./index";

const ORG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOrgUuid(value: string): boolean {
  return ORG_ID.test(value.trim());
}

export function isolationContextItem(orgId: string): ContextItem {
  const id = orgId.trim();
  return {
    type: "team_memory",
    id: `org-isolation:${id}`,
    importance: 100,
    content: [
      `This request is exclusively for organization ${id}.`,
      `On-disk work for this team is only the coding folder org-${id} — never a sibling org-* folder.`,
      "You have no memory of any other team, user, or workspace.",
      "Use only the context items and chat history in this request.",
      "If a fact is not present here, say it is unknown — do not recall another team's data.",
    ].join(" "),
  };
}

/** Drop items that name a different org uuid than the caller. */
export function filterContextToOrg(orgId: string, items: readonly ContextItem[]): ContextItem[] {
  const mine = orgId.trim().toLowerCase();
  return items.filter((item) => {
    const ids = [item.id, ...item.id.split(/[/:]/)].map((part) => part.trim().toLowerCase());
    const named = ids.filter((part) => ORG_ID.test(part));
    if (named.length === 0) return true;
    return named.every((part) => part === mine);
  });
}

export function isolateOrgChatInput<
  T extends { context: ContextItem[]; message: string; history?: unknown },
>(orgId: string, input: T): T {
  const kept = filterContextToOrg(orgId, input.context);
  return {
    ...input,
    context: [isolationContextItem(orgId), ...kept.filter((item) => !item.id.startsWith("org-isolation:"))],
  };
}

/**
 * Adapter wrapper so a caller cannot forget the isolation step on the relay path.
 * The inner adapter still sees the same tools and history; only context is gated.
 */
export class OrgIsolatedChatAdapter implements ChatAdapter {
  readonly supportsNativeTools: boolean;

  constructor(
    private readonly inner: ChatAdapter,
    private readonly orgId: string,
  ) {
    this.supportsNativeTools = inner.supportsNativeTools === true;
  }

  get provider(): string {
    return this.inner.provider;
  }

  get model(): string {
    return this.inner.model;
  }

  estimateCostUsd(promptTokens: number, completionTokens: number): number {
    return this.inner.estimateCostUsd?.(promptTokens, completionTokens) ?? 0;
  }

  complete(input: {
    message: string;
    context: ContextItem[];
    history?: Parameters<ChatAdapter["complete"]>[0]["history"];
    tools?: Parameters<ChatAdapter["complete"]>[0]["tools"];
    promptCachingEnabled?: boolean;
  }): Promise<ChatCompletionResult> {
    return this.inner.complete(isolateOrgChatInput(this.orgId, input));
  }
}
