import type { ReactNode } from "react";

/**
 * Event day's outer element: its own <main> as a page, a <div> inside the Competition hub, which
 * already has the page's <main>. Two nested <main> landmarks confused screen readers.
 */
export function EdcRoot({ embedded, className, children }: { embedded: boolean; className: string; children: ReactNode }) {
  return embedded ? <div className={className}>{children}</div> : <main className={className}>{children}</main>;
}
