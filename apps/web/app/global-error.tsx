"use client";

import { useEffect } from "react";

/**
 * Last-resort error boundary — catches a throw in the root layout itself,
 * which `error.tsx` cannot (it renders inside the layout that just failed).
 *
 * Without this file a root-layout failure in production is Next's bare
 * "Application error: a client-side exception has occurred" on a white page.
 * This has to paint its own <html> and <body> and cannot rely on the app's
 * stylesheets or fonts having loaded, so the styling is inline and plain.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[vantage] root layout error", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f6f7fb",
          color: "#101828",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <main
          style={{
            maxWidth: 520,
            margin: 24,
            padding: 24,
            background: "#fff",
            border: "1px solid #e4e7ec",
            borderRadius: 14,
            boxShadow: "0 1px 2px rgba(16, 24, 40, 0.06)",
          }}
        >
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#667085" }}>
            VANTAGE
          </p>
          <h1 style={{ margin: "8px 0 6px", fontSize: 22 }}>Vantage hit a problem it could not recover from</h1>
          <p style={{ margin: "0 0 16px", lineHeight: 1.5, color: "#475467" }}>
            Nothing you entered was lost on the server. Try again; if it happens twice, reload the page. If it keeps
            happening, write to{" "}
            <a href="mailto:sahiljpatel2011@gmail.com" style={{ color: "#1f4fd6" }}>
              sahiljpatel2011@gmail.com
            </a>
            {error.digest ? (
              <>
                {" "}
                and mention <code style={{ fontFamily: "ui-monospace, monospace" }}>{error.digest}</code>
              </>
            ) : null}
            .
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: 0,
                background: "#1f4fd6",
                color: "#fff",
                font: "inherit",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/dashboard"
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #d0d5dd",
                color: "#101828",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              Go to Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
