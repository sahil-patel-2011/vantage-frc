import type { ReactNode } from "react";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { TextBlockSkeleton } from "./skeleton";

export type ShellState = "loading" | "empty" | "setup" | "filtered_empty" | "error" | "ready";

type ShellProps = {
  state: ShellState;
  /** Module's layout-matched Skeleton (NOT a text EmptyState). Falls back to a generic
   * skeleton block below — always a real placeholder shape, never bare "Loading…" text. */
  loading?: ReactNode;
  /** Accessible label for the loading region when no custom `loading` node is supplied. */
  loadingLabel?: string;
  /** First-run: nothing yet + primary CTA. */
  empty?: ReactNode;
  /** EmptyState with a SetupChecklist. */
  setup?: ReactNode;
  /** Real data exists server-side but the active filter matched nothing. */
  filteredEmpty?: ReactNode;
  /** Rendered via ErrorState with the REAL message + always-on (recoverable) retry.
   * `status` feeds the same auth/forbidden/offline/setup classifier ErrorState uses on
   * its own, so a Shell error and a directly-rendered ErrorState always agree. */
  error?: { title?: ReactNode; message?: ReactNode; status?: number | null; onRetry?: () => void };
  /** The live view — rendered only when state === "ready". */
  children: ReactNode;
};

/**
 * One classifier → render mapper so every module treats loading/empty/setup/
 * filtered_empty/error/ready consistently. The fourth state (filtered_empty)
 * stops telling an active team with real data that they "haven't submitted anything yet".
 */
export function Shell({
  state,
  loading,
  loadingLabel = "Loading",
  empty,
  setup,
  filteredEmpty,
  error,
  children,
}: ShellProps) {
  switch (state) {
    case "loading":
      return (
        <div aria-busy="true" aria-label={loading ? undefined : loadingLabel}>
          {loading ?? <TextBlockSkeleton lines={4} />}
        </div>
      );
    case "empty":
      return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
    case "setup":
      return <>{setup ?? <EmptyState title="Finish setup" badge="Setup" badgeTone="setup" />}</>;
    case "filtered_empty":
      return (
        <>
          {filteredEmpty ?? (
            <EmptyState title="No matches for this filter" description="Try clearing or widening your filters." />
          )}
        </>
      );
    case "error":
      return (
        <ErrorState title={error?.title} message={error?.message} status={error?.status} onRetry={error?.onRetry} />
      );
    case "ready":
    default:
      return <>{children}</>;
  }
}
