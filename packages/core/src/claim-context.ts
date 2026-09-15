import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ claimToken: string | null }>();

export function runWithClaimIntent<T>(claimToken: string | null, fn: () => T): T {
  return store.run({ claimToken }, fn);
}

export function currentClaimIntentToken(): string | null {
  const value = store.getStore()?.claimToken?.trim() ?? null;
  return value || null;
}
