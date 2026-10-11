import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pathnameUsesAppShell } from "./product-route";
import { pathnameIsBareShell, shellBodyClasses } from "./shell-body-class";

const WEB = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");

describe("app frame classes on <body>", () => {
  it("marks every product route, and only product routes", () => {
    for (const path of ["/dashboard", "/team", "/competition", "/account", "/safety", "/onboarding"]) {
      expect(shellBodyClasses(path)).toContain("has-app-shell");
    }
    for (const path of ["/", "/pricing", "/signin", "/scout", "/scout/pit", "/display/pit/abc"]) {
      expect(shellBodyClasses(path)).toEqual([]);
    }
  });

  it("agrees with the rule that mounts AppShell", () => {
    for (const path of ["/dashboard", "/", "/scout/match", "/invite", "/nope-not-a-page", "/f/0123456789abcdef0123456789abcdef"]) {
      expect(shellBodyClasses(path).includes("has-app-shell")).toBe(pathnameUsesAppShell(path));
    }
  });

  it("keeps the bare and onboarding frames", () => {
    expect(shellBodyClasses("/invite")).toEqual(["has-app-shell", "shell-bare"]);
    expect(shellBodyClasses("/no-such-page")).toEqual(["has-app-shell", "shell-bare"]);
    expect(shellBodyClasses("/onboarding")).toEqual(["has-app-shell", "shell-onboarding"]);
    expect(pathnameIsBareShell("/dashboard")).toBe(false);
  });
});

describe("first paint is the finished frame (A6-01, A6-06)", () => {
  it("renders <body> through AppBody, whose server HTML carries the classes", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/<AppBody>/);
    expect(layout).not.toMatch(/^\s*<body[\s>]/m);
    const body = read("components/app-body.tsx");
    expect(body).toMatch(/useState\(\(\) => shellBodyClasses\(pathname\)/);
    expect(body).toMatch(/useLayoutEffect/);
  });

  it("no longer adds the frame classes in an effect after paint", () => {
    const shell = read("components/app-shell.tsx");
    expect(shell).not.toMatch(/classList\.(add|toggle)\("has-app-shell"/);
    expect(shell).not.toMatch(/classList\.toggle\("shell-bare"/);
    expect(shell).not.toMatch(/classList\.toggle\("shell-onboarding"/);
  });

  it("sets the theme from a raw script in <head>, not a queued beforeInteractive", () => {
    const layout = read("app/layout.tsx");
    expect(layout).not.toMatch(/strategy="beforeInteractive"/);
    const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
    expect(head).toMatch(/<script id="vantage-theme" dangerouslySetInnerHTML=\{\{ __html: THEME_BOOTSTRAP_SCRIPT \}\} \/>/);
  });

  it("defaults the Appearance control to System", () => {
    const provider = read("app/theme-provider.tsx");
    expect(provider).toMatch(/return storedPreference\(\) \?\? "system";/);
    expect(provider).not.toMatch(/storedPreference\(\) \?\? "light"/);
  });
});
