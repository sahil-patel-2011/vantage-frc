import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorState } from "./error-state";
import { GENERIC_LOAD_FAILURE } from "../../lib/ui/load-failure";

/*
  A6-12 / A2-20: Money under load showed "Something went wrong" over "signal timed out" (the
  browser's AbortSignal text). The shared error state now says what happened and what to do, and
  never prints a program's exception text; Retry stays.
*/

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ErrorState, props as never));

describe("ErrorState", () => {
  it("turns a timeout into a slow-connection message with Retry", () => {
    const html = render({ title: "Something went wrong", message: "signal timed out" });
    expect(html).toContain("This is taking longer than usual");
    expect(html).toContain("Slow connection");
    expect(html).not.toContain("signal timed out");
    expect(html).not.toContain("Something went wrong");
    expect(html).toContain(">Retry<");
  });

  it("never shows exception text, and says what to do instead", () => {
    const html = render({ message: "TypeError: Cannot read properties of undefined (reading 'rows')" });
    expect(html).not.toContain("TypeError");
    expect(html).toContain("This didn&#x27;t load");
    expect(html).toContain(GENERIC_LOAD_FAILURE.replace("couldn't", "couldn&#x27;t"));
  });

  it("still shows an API's own sentence and a caller's own title", () => {
    const html = render({ title: "Couldn't load the budget", message: "The season budget has not been set up yet." });
    expect(html).toContain("Couldn&#x27;t load the budget");
    expect(html).toContain("The season budget has not been set up yet.");
  });
});
