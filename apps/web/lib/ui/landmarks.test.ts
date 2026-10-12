import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageMain } from "../../components/ui/page-main";

/*
  A6-18: one <main> per page. /build?tab=code and /ai had two (the hub's and the embedded
  feature's); /scout/pit and /scout/match had none; Hours and the Scouting app home skipped
  from h1 to h3.
*/

const WEB = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");

describe("PageMain", () => {
  it("is the <main> landmark on its own, and a <div> inside another PageMain", () => {
    const alone = renderToStaticMarkup(createElement(PageMain, { className: "module-page" }, "x"));
    expect(alone).toBe('<main data-page-main="" class="module-page">x</main>');
    const nested = renderToStaticMarkup(
      createElement(PageMain, { className: "hub" }, createElement(PageMain, { className: "feature" }, "x")),
    );
    expect(nested.match(/<main\b/g)).toHaveLength(1);
    expect(nested).toContain('<div data-page-main="nested" class="feature">x</div>');
  });
});

describe("feature pages that a hub embeds use PageMain, not a second <main>", () => {
  const embedded = [
    "components/product-hub.tsx",
    "app/business/business-client.tsx",
    "components/hub-access-gate.tsx",
    "app/code/code-ready-view.tsx",
    "app/chat/chat-client.tsx",
    "app/orders/orders-client.tsx",
    "app/team/ai-memory/ai-memory-client.tsx",
    "app/team/ai-policy/ai-policy-client.tsx",
    "app/team/budgets/budget-client.tsx",
    "app/writer/writer-client.tsx",
  ];
  for (const file of embedded) {
    it(file, () => {
      const source = read(file);
      expect(source).not.toMatch(/<main\b/);
      expect(source).toMatch(/<PageMain\b/);
    });
  }

  it("keeps the hub panel's layout for the nested <div>", () => {
    expect(read("app/product-hub.css")).toMatch(/\.product-hub-panel > \[data-page-main\],/);
  });
});

describe("Scouting app pages have exactly one <main>", () => {
  it("wraps Pit and Match scouting in one, and the match stage is a section", () => {
    for (const page of ["app/scout/pit/page.tsx", "app/scout/match/page.tsx"]) {
      expect(read(page)).toMatch(/<main className="qs-page">/);
    }
    const stage = read("app/scout/match/quick-scout-match.tsx");
    expect(stage).not.toMatch(/<main\b/);
    expect(stage).toMatch(/<section className="qs-stage"/);
  });
});

describe("headings do not skip a level", () => {
  it("Hours' first card is an h2", () => {
    expect(read("app/hours/hours-forms.tsx")).toMatch(/<h2>Scan a card<\/h2>/);
  });
  it("the Scouting app home asks the sharing card for an h2", () => {
    expect(read("app/scout/scouting-home.tsx")).toMatch(/<ScoutingSharing[^>]*headingLevel=\{2\}/);
  });
});
