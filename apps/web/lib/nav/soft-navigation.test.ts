import { describe, expect, it } from "vitest";
import { softNavigationTarget } from "./soft-navigation";

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const anchor = (href: string, extra: Partial<Parameters<typeof softNavigationTarget>[1]> = {}) => ({
  href,
  target: "",
  hasDownload: false,
  rel: "",
  fullReload: false,
  ...extra,
});
const here = new URL("https://vantagefrc.vercel.app/dashboard?orgId=o1");

describe("softNavigationTarget", () => {
  it("routes plain in-app links through the router", () => {
    expect(softNavigationTarget(click, anchor("/competition?orgId=o1"), here)).toBe("/competition?orgId=o1");
    expect(softNavigationTarget(click, anchor("https://vantagefrc.vercel.app/team#roster"), here)).toBe("/team#roster");
  });

  it("leaves everything that must be a real browser navigation alone", () => {
    expect(softNavigationTarget({ ...click, defaultPrevented: true }, anchor("/team"), here)).toBeNull();
    expect(softNavigationTarget({ ...click, metaKey: true }, anchor("/team"), here)).toBeNull();
    expect(softNavigationTarget({ ...click, button: 1 }, anchor("/team"), here)).toBeNull();
    expect(softNavigationTarget(click, anchor("/team", { target: "_blank" }), here)).toBeNull();
    expect(softNavigationTarget(click, anchor("/team", { fullReload: true }), here)).toBeNull();
    expect(softNavigationTarget(click, anchor("/export.csv"), here)).toBeNull();
    expect(softNavigationTarget(click, anchor("/report", { hasDownload: true }), here)).toBeNull();
    expect(softNavigationTarget(click, anchor("/api/handoff/start?to=scouting"), here)).toBeNull();
    expect(softNavigationTarget(click, anchor("https://docs.google.com/x"), here)).toBeNull();
    expect(softNavigationTarget(click, anchor("mailto:a@b.co"), here)).toBeNull();
    expect(softNavigationTarget(click, anchor("#main-content"), here)).toBeNull();
  });
});
