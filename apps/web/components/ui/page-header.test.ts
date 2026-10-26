import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
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
    expect(markup).toContain("app-page-actions");
    expect(markup).toContain("Assign scouts");
    expect(markup).not.toContain("page-options");
    expect(markup).not.toContain("data-primary-action");
  });

  it("keeps three quiet actions visible and files the rest under More", () => {
    const markup = renderToStaticMarkup(createElement(PageHeader, { title: "Calendar" },
      createElement("button", { key: "create", type: "button" }, "Create event"),
      createElement("button", { key: "import", type: "button" }, "Import"),
      createElement("button", { key: "share", type: "button" }, "Share"),
      createElement("button", { key: "export", type: "button" }, "Export")));
    expect(markup.indexOf("Create event")).toBeLessThan(markup.indexOf("<details"));
    expect(markup.indexOf("Import")).toBeLessThan(markup.indexOf("<details"));
    expect(markup.indexOf("Share")).toBeLessThan(markup.indexOf("<details"));
    expect(markup.indexOf("Export")).toBeGreaterThan(markup.indexOf("<details"));
    expect(markup).toContain(">More<");
  });

  it("renders one filled action when the header asks for two", () => {
    const markup = renderToStaticMarkup(createElement(PageHeader, { title: "Strategy" },
      createElement("div", { className: "strategy-header-actions" },
        createElement(Button, { variant: "primary" }, "Recompute"),
        createElement(Button, { variant: "secondary" }, "Print"),
        createElement(Button, { variant: "secondary" }, "Draft"),
        createElement(Button, { variant: "secondary" }, "Export"),
        createElement(Button, { variant: "secondary" }, "Team data"),
        createElement(Button, { variant: "danger" }, "Delete"),
      )));
    expect(markup.match(/data-primary-action="true"/g)).toHaveLength(1);
    expect(markup.match(/\bis-primary\b/g)).toHaveLength(1);
    expect(markup).toContain("strategy-header-actions");
    expect(markup.indexOf("Print")).toBeLessThan(markup.indexOf("<details"));
    expect(markup.indexOf("Export")).toBeLessThan(markup.indexOf("<details"));
    expect(markup.indexOf("Team data")).toBeGreaterThan(markup.indexOf("<details"));
    expect(markup.indexOf("Delete")).toBeGreaterThan(markup.indexOf("<details"));
    expect(markup.indexOf("data-primary-action")).toBeGreaterThan(markup.indexOf("<details"));
    const outside = markup.slice(0, markup.indexOf("<details"));
    expect(outside).not.toContain("Delete");
  });

  it("keeps a fragment of actions in the same More menu", () => {
    const markup = renderToStaticMarkup(createElement(PageHeader, { title: "Strategy" },
      createElement("div", { className: "strategy-header-actions" },
        createElement(Button, { variant: "secondary" }, "Share"),
        createElement(Button, { variant: "secondary" }, "Print"),
        createElement(Button, { variant: "primary" }, "Recompute"),
        createElement(Fragment, null,
          createElement(Button, { variant: "secondary" }, "Draft"),
          createElement(Button, { variant: "secondary" }, "Export"),
          createElement(Button, { variant: "secondary" }, "Team data"),
        ),
      )));
    expect(markup.match(/<details/g)).toHaveLength(1);
    expect(markup.indexOf("Draft")).toBeLessThan(markup.indexOf("<details"));
    expect(markup.indexOf("Export")).toBeGreaterThan(markup.indexOf("<details"));
    expect(markup.indexOf("Team data")).toBeGreaterThan(markup.indexOf("<details"));
    expect(markup.match(/data-primary-action="true"/g)).toHaveLength(1);
  });

  it("does not render an empty action region", () => {
    const markup = renderToStaticMarkup(createElement(PageHeader, { title: "Scouting" }));
    expect(markup).not.toContain("app-page-actions");
  });
});
