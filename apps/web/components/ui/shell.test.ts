/**
 * Contract tests for the Shell state → render mapper (shell.tsx).
 *
 * Rendered with `react-dom/server` (see field.test.ts for why) rather than jsdom.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Shell } from "./shell";

function render(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(Shell, props as never));
}

describe("Shell", () => {
  it("renders children only when ready", () => {
    const markup = render({ state: "ready", children: createElement("p", null, "Live content") });
    expect(markup).toContain("Live content");
  });

  it("never renders children while loading, even if they are passed", () => {
    const markup = render({ state: "loading", children: createElement("p", null, "Should not appear") });
    expect(markup).not.toContain("Should not appear");
    expect(markup).toContain('aria-busy="true"');
  });

  it("falls back to a real skeleton shape when loading has no custom node, not bare text", () => {
    const markup = render({ state: "loading", children: null });
    // TextBlockSkeleton renders aria-hidden shimmer spans, not a visible "Loading…" string.
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("Loading…");
  });

  it("uses the caller's loading node verbatim when supplied", () => {
    const markup = render({ state: "loading", loading: createElement("p", null, "Custom skeleton"), children: null });
    expect(markup).toContain("Custom skeleton");
  });

  it("renders the default empty/setup/filtered_empty copy when no override is supplied", () => {
    expect(render({ state: "empty", children: null })).toContain("Nothing here yet");
    expect(render({ state: "setup", children: null })).toContain("Finish setup");
    expect(render({ state: "filtered_empty", children: null })).toContain("No matches for this filter");
  });

  it("prefers a caller-supplied node for empty/setup/filtered_empty over the default copy", () => {
    const markup = render({
      state: "empty",
      empty: createElement("p", null, "Custom empty"),
      children: null,
    });
    expect(markup).toContain("Custom empty");
    expect(markup).not.toContain("Nothing here yet");
  });

  it("renders ErrorState for the error branch with the real message, not a placeholder", () => {
    const markup = render({
      state: "error",
      error: { message: "Could not load batteries" },
      children: null,
    });
    expect(markup).toContain("Could not load batteries");
    expect(markup).toContain('role="alert"');
  });

  it("feeds error.status through to ErrorState's own auth/forbidden/offline classifier", () => {
    const authMarkup = render({ state: "error", error: { status: 401 }, children: null });
    expect(authMarkup).toContain("Your session ended");

    const forbiddenMarkup = render({ state: "error", error: { status: 403 }, children: null });
    // React SSR HTML-escapes the apostrophe as an entity.
    expect(forbiddenMarkup).toContain("You don");
    expect(forbiddenMarkup).toContain("t have access to this");
  });
});
