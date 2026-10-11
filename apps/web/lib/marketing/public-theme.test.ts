/**
 * The public pages stay light for a device that picked Dark (QA A1-02: pale text on a white page,
 * "Sign in" nearly invisible, after choosing Dark in Account and signing out).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { marketingPagePaths, pathnameIsMarketingPage } from "./public-theme";

const WEB = join(__dirname, "..", "..");

function collect(dir: string, test: (name: string) => boolean, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, test, acc);
    else if (test(entry)) acc.push(full);
  }
  return acc;
}

/** app/pricing/page.tsx → /pricing; route groups like (marketing) do not count. */
function routeOf(pageFile: string): string {
  const parts = relative(join(WEB, "app"), pageFile).split(sep).slice(0, -1).filter((part) => !/^\(.*\)$/.test(part));
  return `/${parts.join("/")}`;
}

describe("public pages render light whatever the device chose", () => {
  it("covers every page that draws the marketing canvas", () => {
    const pages = collect(join(WEB, "app"), (name) => name === "page.tsx").filter((file) =>
      readFileSync(file, "utf8").includes("marketing-lux"),
    );
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      expect(pathnameIsMarketingPage(routeOf(page)), routeOf(page)).toBe(true);
    }
  });

  it("matches with or without a trailing slash, and leaves sign-in and the product alone", () => {
    expect(pathnameIsMarketingPage("/")).toBe(true);
    expect(pathnameIsMarketingPage("/privacy/")).toBe(true);
    expect(pathnameIsMarketingPage("/pricing")).toBe(true);
    for (const path of ["/signin", "/invite", "/join-team", "/onboarding", "/dashboard", "/scout", "/account", null, ""]) {
      expect(pathnameIsMarketingPage(path), String(path)).toBe(false);
    }
    expect(marketingPagePaths()).toContain("/terms");
  });

  it("has no dark variant left in any stylesheet for the marketing canvas", () => {
    const sheets = collect(join(WEB, "app"), (name) => name.endsWith(".css")).concat(
      collect(join(WEB, "components"), (name) => name.endsWith(".css")),
    );
    for (const sheet of sheets) {
      const css = readFileSync(sheet, "utf8");
      expect(css, relative(WEB, sheet)).not.toMatch(/data-theme="dark"\][^{,]*\.(marketing-lux|legal-doc)\b/);
    }
  });

  it("restates the light product tokens on the marketing canvas, so a dark <html> cannot reach them", () => {
    const system = readFileSync(join(WEB, "app", "system.css"), "utf8");
    const guard = /\.marketing-lux\s*\{\s*color-scheme:\s*light;([^}]*)\}/.exec(system)?.[1] ?? "";
    for (const token of ["--bg", "--surface", "--line", "--ink", "--muted", "--accent", "--danger", "--critical"]) {
      expect(guard, token).toMatch(new RegExp(`${token}:\\s*#`));
    }
  });

  it("is applied by ThemeProvider without saving a choice", () => {
    const provider = readFileSync(join(WEB, "app", "theme-provider.tsx"), "utf8");
    expect(provider).toMatch(/pathnameIsMarketingPage\(pathname\)/);
    expect(provider).toMatch(/showDocumentTheme\("light"\)/);
    // Showing light must not write the preference cookie or storage.
    const show = /function showDocumentTheme[\s\S]*?\n\}/.exec(provider)?.[0] ?? "";
    expect(show).not.toMatch(/cookie|localStorage/);
  });
});
