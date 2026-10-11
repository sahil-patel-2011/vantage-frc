"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * False only while hydrating server HTML; true on every client render after that, including the
 * very first render of a component mounted by a client navigation.
 *
 * The usual `useState(false)` + `useEffect(() => set(true))` is false for one render on every
 * mount, so Home said "Welcome" for a frame each time you came back to it before its greeting
 * appeared.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
