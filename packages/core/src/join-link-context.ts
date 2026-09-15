import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ joinToken: string | null }>();

/** Cookie written by `/join` so Google and email sign-up can see the open link. */
export const JOIN_LINK_COOKIE = "vantage_join";

export function runWithJoinLinkToken<T>(joinToken: string | null, fn: () => T): T {
  return store.run({ joinToken }, fn);
}

export function currentJoinLinkToken(): string | null {
  const value = store.getStore()?.joinToken?.trim() ?? null;
  return value || null;
}
