/**
 * The signed-in person's pinned apps, published by the shell so a page can avoid
 * repeating those same links in its own bar. Empty until the shell has published.
 */

let current: readonly string[] = [];
const listeners = new Set<() => void>();

export function publishPinnedHrefs(hrefs: readonly string[]): void {
  current = hrefs;
  listeners.forEach((listener) => listener());
}

export function subscribePinnedHrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pinnedHrefsSnapshot(): readonly string[] {
  return current;
}
