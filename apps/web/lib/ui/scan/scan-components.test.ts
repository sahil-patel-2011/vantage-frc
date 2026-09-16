import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScanGroup, ScanKicker, ScanRail, ScanWorkbench } from "../../../components/ui/scan";

describe("scan components", () => {
  it("renders a numbered rail with current/done/upcoming", () => {
    const html = renderToStaticMarkup(
      createElement(ScanRail, {
        "aria-label": "Onboarding progress",
        current: "team",
        steps: [
          { id: "profile", label: "You" },
          { id: "team", label: "Team" },
          { id: "preferences", label: "Preferences" },
        ],
      }),
    );
    expect(html).toContain("scan-rail");
    expect(html).toContain('data-state="current"');
    expect(html).toContain('data-state="done"');
    expect(html).toContain('aria-current="step"');
    expect(html).not.toContain("Choose tools");
  });

  it("renders grouped work with a kicker and hub workbench", () => {
    const html = renderToStaticMarkup(
      createElement(
        ScanWorkbench,
        { hub: "dashboard" },
        createElement(ScanKicker, null, "This week"),
        createElement(
          ScanGroup,
          { label: "What to do now", band: "a" },
          createElement("p", null, "Nothing you have to do right now."),
        ),
      ),
    );
    expect(html).toContain("scan-hub--dashboard");
    expect(html).toContain("scan-kicker");
    expect(html).toContain('data-label="What to do now"');
    expect(html).toContain("Nothing you have to do right now.");
  });
});
