"use client";

import { useEffect } from "react";
import { ErrorState } from "../components/ui";

/**
 * Root error boundary.
 *
 * Without it, a render-time throw anywhere under app/ fell through to Next's
 * own error screen — no product chrome, no recovery beyond a browser reload,
 * and in production a bare "Application error" string. ErrorState classifies
 * the failure (expired session vs no access vs offline vs unknown) and offers
 * the recovery that can actually succeed.
 *
 * `reset()` re-renders the segment, which is the right first try for a
 * transient failure; ErrorState falls back to a full reload if it is not given
 * a handler.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack in production.
    console.error("[vantage] unhandled render error", error.digest ?? "", error);
  }, [error]);

  return (
    <main className="module-page">
      <ErrorState
        title="Something went wrong on this screen"
        message={error.message}
        onRetry={reset}
        retryLabel="Try again"
      />
    </main>
  );
}
