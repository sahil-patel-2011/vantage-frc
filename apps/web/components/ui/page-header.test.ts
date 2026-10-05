import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("puts page actions in the shared discoverable action region", () => {
    const markup = renderToStaticMarkup(
      createElement(
        PageHeader,
        { title: "Scouting", description: "Cover every match." },
        createElement("button", { type: "button" }, "Assign scouts"),
      ),
    );

    expect(markup).toContain("<h1>Scouting</h1>");
    expect(markup).toContain('class="app-page-actions"');
    expect(markup).toContain("Assign scouts");
    expect(markup).not.toContain("page-options");
  });

  it("keeps two actions visible and groups additional controls", () => {
    const markup = renderToStaticMarkup(createElement(PageHeader, { title: "Calendar" },
      createElement("button", { key: "create" }, "Create event"),
      createElement("button", { key: "import" }, "Import"),
      createElement("button", { key: "export" }, "Export")));
    expect(markup.indexOf("Create event")).toBeLessThan(markup.indexOf('<details'));
    expect(markup.indexOf("Import")).toBeLessThan(markup.indexOf('<details'));
    expect(markup.indexOf("Export")).toBeGreaterThan(markup.indexOf('<details'));
  });

  it("does not render an empty action region", () => {
    const markup = renderToStaticMarkup(createElement(PageHeader, { title: "Scouting" }));
    expect(markup).not.toContain("app-page-actions");
  });
});
