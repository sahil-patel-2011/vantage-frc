import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isErrorRegion } from "./status-echo";

/*
  From the operations pass (A5-06, A5-28): the echo toast reserved 96px at the bottom even where
  there is no bottom bar, so a visible "Added …" line on a computer was echoed over the form; and
  any class containing "fail" turned the toast red, including a guided step's amber "not yet".
*/

const region = (role: string | null, className: string) =>
  ({ getAttribute: (name: string) => (name === "role" ? role : null), className }) as unknown as Element;

describe("status echo", () => {
  it("takes its tone from the region: alerts and error-styled lines only", () => {
    expect(isErrorRegion(region("alert", ""))).toBe(true);
    expect(isErrorRegion(region("status", "telemetry-status error"))).toBe(true);
    expect(isErrorRegion(region("status", "soft-toast bad"))).toBe(true);
    expect(isErrorRegion(region("status", "guided-result is-fail"))).toBe(false);
    expect(isErrorRegion(region("status", "telemetry-status success"))).toBe(false);
  });

  it("measures the bars that are actually showing, and ignores loading cards", () => {
    const source = readFileSync(join(__dirname, "status-echo.tsx"), "utf8");
    expect(source).toMatch(/const bottom = shownRect\("\.soft-island"\)\?\.top \?\? window\.innerHeight;/);
    expect(source).not.toMatch(/window\.innerHeight - 96/);
    expect(source).toMatch(/if \(region\.closest\('\[aria-busy="true"\]'\)\) continue;/);
  });
});
