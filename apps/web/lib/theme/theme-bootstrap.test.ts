import { describe, expect, it } from "vitest";
import { THEME_BOOTSTRAP_SCRIPT } from "./theme-bootstrap";

type Boot = {
  cookie?: string;
  storage?: Record<string, string>;
  osDark?: boolean;
  storageThrows?: boolean;
};

/** Runs the real script string against a stand-in document, the way the browser runs it in <head>. */
function boot({ cookie = "", storage = {}, osDark = false, storageThrows = false }: Boot) {
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const document = { cookie, documentElement: root };
  const localStorage = {
    getItem(key: string) {
      if (storageThrows) throw new Error("SecurityError");
      return storage[key] ?? null;
    },
  };
  const window = { matchMedia: (query: string) => ({ matches: osDark && query.includes("dark") }) };
  new Function("document", "localStorage", "window", THEME_BOOTSTRAP_SCRIPT)(document, localStorage, window);
  return { theme: root.dataset.theme, colorScheme: root.style.colorScheme };
}

describe("theme before the first frame", () => {
  it("follows the device when nothing was ever chosen", () => {
    expect(boot({ osDark: true })).toEqual({ theme: "dark", colorScheme: "dark" });
    expect(boot({ osDark: false })).toEqual({ theme: "light", colorScheme: "light" });
  });

  it("lets an explicit choice beat the device, cookie first", () => {
    expect(boot({ osDark: true, cookie: "vantage-theme-pref=light" }).theme).toBe("light");
    expect(boot({ osDark: false, storage: { "vantage-theme-pref": "dark" } }).theme).toBe("dark");
    expect(boot({ cookie: "a=1; vantage-theme-pref=dark", storage: { "vantage-theme-pref": "light" } }).theme).toBe("dark");
  });

  it("treats System as the device", () => {
    expect(boot({ osDark: true, cookie: "vantage-theme-pref=system" }).theme).toBe("dark");
    expect(boot({ osDark: false, storage: { "vantage-theme-pref": "system" } }).theme).toBe("light");
  });

  it("still honours a resolved theme saved by an older version", () => {
    expect(boot({ osDark: false, cookie: "vantage-theme=dark" }).theme).toBe("dark");
    expect(boot({ osDark: true, storage: { "vantage-theme": "light" } }).theme).toBe("light");
  });

  it("falls back to the device when storage is blocked", () => {
    expect(boot({ osDark: true, storageThrows: true }).theme).toBe("dark");
  });
});
