/** Contract tests for EmptyState's shell-variant selection (empty-state.tsx). */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

function render(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(EmptyState, props as never));
}

describe("EmptyState", () => {
  it("defaults to the raised app-card/soft-panel shell", () => {
    const markup = render({ title: "Nothing yet" });
    expect(markup).toMatch(/class="app-card soft-panel/);
  });

  it("uses the dashed soft-empty shell when soft is set", () => {
    const markup = render({ title: "Nothing yet", soft: true });
    expect(markup).toMatch(/class="soft-empty/);
    expect(markup).not.toContain("app-card soft-panel");
  });

  it("uses the borderless compact shell when compact is set, and compact wins over soft", () => {
    const markup = render({ title: "Nothing yet", compact: true, soft: true });
    expect(markup).toMatch(/class="soft-empty-compact/);
  });

  it("always renders a visible title and only renders the badge/description when given", () => {
    const bare = render({ title: "Nothing yet" });
    expect(bare).toContain("Nothing yet");
    expect(bare).not.toContain("app-badge");

    const withExtras = render({ title: "Nothing yet", description: "Try again later", badge: "Setup", badgeTone: "setup" });
    expect(withExtras).toContain("Try again later");
    expect(withExtras).toMatch(/class="app-badge setup"/);
  });
});
