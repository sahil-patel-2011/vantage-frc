import { afterEach, describe, expect, it, vi } from "vitest";
import { pushAppNavigation, softNavigationTarget } from "./soft-navigation";
import { URL_CHANGE_EVENT } from "./url-change";

describe("mounted views follow router navigation", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function browser() {
    vi.useFakeTimers();
    const target = Object.assign(new EventTarget(), {
      location: { href: "https://vantage.local/ai?tab=writer", assign: vi.fn() },
      setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    });
    vi.stubGlobal("window", target);
    const changed = vi.fn();
    target.addEventListener(URL_CHANGE_EVENT, changed);
    return { target, changed };
  }

  it("notifies only after the router commits the new query", () => {
    const { target, changed } = browser();
    const push = vi.fn((href: string) => setTimeout(() => { target.location.href = `https://vantage.local${href}`; }, 20));
    pushAppNavigation(push, "/ai?tab=connections");
    expect(push).toHaveBeenCalledWith("/ai?tab=connections");
    vi.advanceTimersByTime(49);
    expect(changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(changed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops waiting when navigation does not change the address", () => {
    const { changed } = browser();
    pushAppNavigation(vi.fn(), "/ai?tab=writer");
    vi.runAllTimers();
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back to a document navigation if the router is unavailable", () => {
    const { target, changed } = browser();
    pushAppNavigation(() => { throw new Error("Router unavailable"); }, "/ai/connect");
    expect(target.location.assign).toHaveBeenCalledWith("/ai/connect");
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

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
  it("keeps explicit membership pickers outside the current team scope", () => {
    const picker = `/workspace?next=${encodeURIComponent("/account?tab=appearance&orgId=o1")}`;
    expect(softNavigationTarget(click, anchor(picker), here)).toBe(picker);
    expect(softNavigationTarget(click, anchor(`${picker}&orgId=o1`), here)).toBe(picker);
    expect(softNavigationTarget(click, anchor(`${picker}&orgId=o2`), here)).toBe(picker);
  });

  it("routes plain in-app links through the router", () => {
    expect(softNavigationTarget(click, anchor("/competition?orgId=o1"), here)).toBe("/competition?orgId=o1");
    expect(softNavigationTarget(click, anchor("https://vantagefrc.vercel.app/team#roster"), here)).toBe("/team?orgId=o1#roster");
  });

  it("remounts the app for a different team and retains context through personal pages", () => {
    expect(softNavigationTarget(click, anchor("/competition?tab=scouting&orgId=o2"), here)).toBeNull();
    expect(softNavigationTarget(click, anchor("/dashboard"), here)).toBe("/dashboard?orgId=o1");
    expect(softNavigationTarget(click, anchor("/account?tab=appearance"), here)).toBe("/account?tab=appearance&orgId=o1");
    expect(softNavigationTarget(click, anchor("/signin"), here)).toBe("/signin");
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
