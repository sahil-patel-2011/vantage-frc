import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which key answered a metered call: by id and label, never the secret.
 *
 * A team, a member or the operator can hold several keys for one provider and the chat adapter
 * fails over between them inside the provider call, so only the adapter knows which one served.
 * meteredAI opens a scope around `invoke`, the adapter notes the key into it, and the usage row
 * records it (`metadata.servedKey`). Outside a metered call, noting is a no-op.
 */

export type ServedKey = {
  id: string;
  label: string;
  /** platform: the operator's pool (AI credit gifts) · org: the team's key · member: a personal key. */
  scope: "platform" | "org" | "member";
};

type Scope = { servedKey?: ServedKey };

const storage = new AsyncLocalStorage<Scope>();

export function noteServedKey(key: ServedKey): void {
  const scope = storage.getStore();
  if (scope) scope.servedKey = { id: key.id, label: key.label.slice(0, 120), scope: key.scope };
}

/** Run `work` (a provider call) and return what it produced plus the key that served it. */
export async function withServedKeyScope<T>(work: () => Promise<T>): Promise<{ value: T; servedKey: ServedKey | null }> {
  const scope: Scope = {};
  const value = await storage.run(scope, work);
  return { value, servedKey: scope.servedKey ?? null };
}
