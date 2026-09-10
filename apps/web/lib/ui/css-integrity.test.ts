/**
 * CSS integrity guard.
 *
 * Commit 80859a3 dropped a `.tc-mode {` selector line, leaving its declarations
 * outside any rule. Next's CSS parser rejected the whole file, and because that
 * stylesheet is in the product-shell import chain, /team, /build, /account and
 * /ai all returned HTTP 500. Neither typecheck nor any unit test noticed.
 *
 * These checks catch that shape of breakage without needing a browser.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = [
  join(__dirname, "..", "..", "app"),
  join(__dirname, "..", "..", "components"),
  join(__dirname, "..", "..", "lib"),
];

function collectCss(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) collectCss(full, acc);
    else if (entry.endsWith(".css")) acc.push(full);
  }
  return acc;
}

const files = ROOTS.flatMap((root) => collectCss(root));

/** Strip comments and string/url contents so braces inside them do not count. */
function scrub(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

describe("stylesheet integrity", () => {
  it("finds the app's stylesheets", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("has balanced braces in every stylesheet", () => {
    const broken: string[] = [];
    for (const file of files) {
      const text = scrub(readFileSync(file, "utf8"));
      let depth = 0;
      let negative = false;
      for (const char of text) {
        if (char === "{") depth += 1;
        else if (char === "}") {
          depth -= 1;
          if (depth < 0) negative = true;
        }
      }
      if (depth !== 0 || negative) {
        broken.push(`${file} (ends at depth ${depth}${negative ? ", closed too many" : ""})`);
      }
    }
    expect(broken, `unbalanced braces:\n  ${broken.join("\n  ")}`).toEqual([]);
  });

  it("never puts a var() inside a media query prelude", () => {
    // `@media (max-width: var(--x))` is not CSS — custom properties are not
    // allowed in a media prelude, so the whole block silently never applies.
    // Eleven such blocks shipped once, from a find-and-replace of `999px` (the
    // pill radius) that also hit `@media(max-width:999px)`; every responsive
    // rule in the marketing stylesheets below 999px was dead for a release.
    const offenders: string[] = [];
    for (const file of files) {
      const text = scrub(readFileSync(file, "utf8"));
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        const match = /@media[^{]*\{/.exec(line) ?? /@media[^{]*$/.exec(line);
        if (match && /var\(/.test(match[0])) offenders.push(`${file}:${index + 1}: ${match[0].trim()}`);
      });
    }
    expect(offenders, `var() in a media prelude:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("has no declaration sitting outside a rule", () => {
    // This is the exact failure that 500'd four hubs.
    const orphans: string[] = [];
    for (const file of files) {
      const text = scrub(readFileSync(file, "utf8"));
      let depth = 0;
      let line = 1;
      let buffer = "";
      for (const char of text) {
        if (char === "\n") {
          line += 1;
          buffer = "";
          continue;
        }
        if (char === "{") {
          depth += 1;
          buffer = "";
          continue;
        }
        if (char === "}") {
          depth = Math.max(0, depth - 1);
          buffer = "";
          continue;
        }
        if (char === ";" && depth === 0) {
          const text = buffer.trim();
          // At depth 0 a semicolon is only legal after an at-rule (@import, @charset).
          if (text && !text.startsWith("@")) {
            orphans.push(`${file}:${line} — "${text.slice(0, 60)}"`);
          }
          buffer = "";
          continue;
        }
        buffer += char;
      }
    }
    expect(orphans, `declarations outside any rule:\n  ${orphans.join("\n  ")}`).toEqual([]);
  });

  it("keeps the stylesheet that once broke four hubs parseable", () => {
    const calendar = files.find((file) => file.endsWith("team-calendar.css"));
    expect(calendar).toBeDefined();
    const text = readFileSync(calendar!, "utf8");
    expect(text).toContain(".tc-mode {");
  });

  it("never writes a custom-property name that would close a CSS comment", () => {
    // `--app-*/` inside `/* ... */` is parsed as the end of the comment.
    // Next then tries to parse the leftover as CSS and the whole sheet fails
    // the production build (layout.tsx imports system.css).
    const footgun = /--[A-Za-z0-9-]*\*\//;
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (footgun.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders, "custom-property names must not contain a comment-ender").toEqual([]);
  });

  it("declares leftover --m-* marketing tokens only in system.css", () => {
    // Three competing palettes is how two secondary buttons on the same
    // screen ended up different colours. Canonical product names live in
    // system.css. Leaf sheets must not redeclare --soft-*/--app-*/--m-* tokens.
    const tokenDecl = /--(?:soft|app|m)-[A-Za-z0-9-]+\s*:/;
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(`${sep}system.css`) || file.endsWith("/system.css")) continue;
      const text = scrub(readFileSync(file, "utf8"));
      text.split("\n").forEach((line, index) => {
        if (tokenDecl.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(
      offenders,
      `token declarations outside system.css:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("does not keep leftover --soft-* or --app-* alias declarations", () => {
    const tokenDecl = /--(?:soft|app)-[A-Za-z0-9-]+\s*:/;
    const offenders: string[] = [];
    for (const file of files) {
      const text = scrub(readFileSync(file, "utf8"));
      text.split("\n").forEach((line, index) => {
        if (tokenDecl.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(
      offenders,
      `leftover --soft-* / --app-* alias declarations:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps product TSX off --soft-* aliases", () => {
    // Canonical names are --bg/--line/--accent. Aliases stay in system.css so
    // leftover stylesheets still resolve. New inline styles should not add a
    // fourth name for the same colour.
    const roots = [
      join(__dirname, "..", "..", "app"),
      join(__dirname, "..", "..", "components"),
      join(__dirname, "..", "..", "lib"),
    ];
    const offenders: string[] = [];
    function walk(dir: string) {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const full = join(dir, entry);
        let stats;
        try {
          stats = statSync(full);
        } catch {
          continue;
        }
        if (stats.isDirectory()) walk(full);
        else if (entry.endsWith(".tsx")) {
          const text = readFileSync(full, "utf8");
          text.split("\n").forEach((line, index) => {
            if (/var\(--soft-/.test(line)) {
              offenders.push(`${full}:${index + 1}: ${line.trim().slice(0, 80)}`);
            }
          });
        }
      }
    }
    for (const root of roots) walk(root);
    expect(offenders, `TSX still uses --soft-*:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("consumes canonical color tokens instead of --soft-* color aliases", () => {
    // Competing palettes is how two secondary buttons on the same screen ended
    // up different colours. Leaf sheets must use --bg/--surface/--ink/--accent
    // (and the other canonical names). Leftover --soft-* aliases are not
    // declared anywhere — product chrome has one token family.
    const colorAlias =
      /var\(--soft-(?:bg|card|ink|muted|line(?:-soft)?|accent(?:-soft|-ink)?|warning(?:-soft)?|danger(?:-soft)?|success(?:-soft)?|surface-2|panel|border|brand|ring|radius(?:-xs|-sm|-lg|-pill)?|shadow(?:-lift|-pop)?)(?=[,)])/;
    const offenders: string[] = [];
    for (const file of files) {
      const text = scrub(readFileSync(file, "utf8"));
      text.split("\n").forEach((line, index) => {
        if (colorAlias.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(
      offenders,
      `CSS still consumes --soft-* color/radius aliases:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("never consumes --app-* tokens in product CSS", () => {
    // Leaf sheets must use the canonical names; a second palette is how two
    // secondary buttons on the same screen ended up different colours.
    const offenders: string[] = [];
    for (const file of files) {
      const text = scrub(readFileSync(file, "utf8"));
      text.split("\n").forEach((line, index) => {
        if (/var\(--app-/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(offenders, `CSS still consumes --app-*:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("keeps product TSX off --app-* aliases", () => {
    const roots = [
      join(__dirname, "..", "..", "app"),
      join(__dirname, "..", "..", "components"),
      join(__dirname, "..", "..", "lib"),
    ];
    const offenders: string[] = [];
    function walk(dir: string) {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const full = join(dir, entry);
        let stats;
        try {
          stats = statSync(full);
        } catch {
          continue;
        }
        if (stats.isDirectory()) walk(full);
        else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
          const text = readFileSync(full, "utf8");
          text.split("\n").forEach((line, index) => {
            if (/var\(--app-/.test(line)) {
              offenders.push(`${full}:${index + 1}: ${line.trim().slice(0, 80)}`);
            }
          });
        }
      }
    }
    for (const root of roots) walk(root);
    expect(offenders, `TS/TSX still uses --app-*:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("keeps product CSS off --m-* marketing tokens", () => {
    // Marketing sheets keep a separate copper/paper palette on purpose.
    // Product chrome must not pick it up or two buttons on the same screen
    // diverge again. system.css may declare the aliases.
    const marketingSheet = /(?:^|[/\\])(?:marketing(?:-v3|-showcase)?|legal)\.css$/;
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(`${sep}system.css`) || file.endsWith("/system.css")) continue;
      if (marketingSheet.test(file)) continue;
      const text = scrub(readFileSync(file, "utf8"));
      text.split("\n").forEach((line, index) => {
        if (/var\(--m-/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(offenders, `product CSS still consumes --m-*:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("keeps product TSX off --m-* marketing tokens", () => {
    const roots = [
      join(__dirname, "..", "..", "app"),
      join(__dirname, "..", "..", "components"),
      join(__dirname, "..", "..", "lib"),
    ];
    const marketingTsx = /(?:^|[/\\])pricing-catalog\.tsx$/;
    const offenders: string[] = [];
    function walk(dir: string) {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const full = join(dir, entry);
        let stats;
        try {
          stats = statSync(full);
        } catch {
          continue;
        }
        if (stats.isDirectory()) walk(full);
        else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
          if (marketingTsx.test(full)) continue;
          const text = readFileSync(full, "utf8");
          text.split("\n").forEach((line, index) => {
            if (/var\(--m-/.test(line)) {
              offenders.push(`${full}:${index + 1}: ${line.trim().slice(0, 80)}`);
            }
          });
        }
      }
    }
    for (const root of roots) walk(root);
    expect(offenders, `product TS/TSX still uses --m-*:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("does not paint a second dark palette with #0f141a / #171d25", () => {
    // Dark mode is the designed tokens in system.css (#0c1118 / #151b24).
    // Sign-in, Event Day, and onboarding used competing wells
    // (#0f141a / #171d25 / #111823 / #152036) that made those screens a different
    // product at night.
    const competing = /#0f141a|#171d25|#111823|#152036|#122a20|#2c1519|#2a2113|#33270f/i;
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, index) => {
        if (competing.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(
      offenders,
      `competing dark hex (use --bg / --surface):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("paints sign-in from canonical tokens in both themes", () => {
    // Same gold as onboarding: light rules consume --bg/--surface/--ink/--accent
    // so a html[data-theme="dark"] counterpart is unnecessary and forbidden.
    const signin = files.find((file) => file.endsWith(`${sep}sign-in-flow.css`) || file.endsWith("/sign-in-flow.css"));
    expect(signin).toBeDefined();
    const text = readFileSync(signin!, "utf8");
    expect(text).not.toMatch(/html\[data-theme=["']dark["']\]/);
    expect(text).not.toMatch(/#6e6e73|#1d1d1f|#f5f5f7|#d2d2d7|#fafafa|#ffffff\b|#fff\b/i);
    expect(text).toContain("var(--bg)");
    expect(text).toContain("var(--surface)");
    expect(text).toContain("var(--accent)");
  });

  it("does not reintroduce product html[data-theme=dark] counterparts", () => {
    // Marketing/legal keep a separate copper palette on purpose. Product chrome
    // must follow tokens that already flip in system.css.
    const allow = /(?:^|[/\\])(?:marketing(?:-v3|-showcase)?|legal|system)\.css$/;
    const offenders: string[] = [];
    for (const file of files) {
      if (allow.test(file)) continue;
      const text = scrub(readFileSync(file, "utf8"));
      text.split("\n").forEach((line, index) => {
        if (/html\[data-theme=["']dark["']\]/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(
      offenders,
      `product dark counterparts (use tokens that already flip):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("does not load marketing stylesheets from the root layout", () => {
    const layout = readFileSync(join(__dirname, "..", "..", "app", "layout.tsx"), "utf8");
    expect(layout).not.toMatch(/marketing(?:-v3)?\.css/);
    const marketingStyles = readFileSync(
      join(__dirname, "..", "..", "components", "marketing", "marketing-styles.ts"),
      "utf8",
    );
    expect(marketingStyles).toMatch(/marketing\.css/);
    expect(marketingStyles).toMatch(/marketing-v3\.css/);
  });

  it("does not load leftover product chrome from the root layout", () => {
    const layout = readFileSync(join(__dirname, "..", "..", "app", "layout.tsx"), "utf8");
    expect(layout).not.toMatch(/soft-ui\.css/);
    expect(layout).not.toMatch(/["']\.\/styles\.css["']/);
    expect(layout).toMatch(/system\.css/);
    const productStyles = readFileSync(
      join(__dirname, "..", "..", "app", "product-styles.ts"),
      "utf8",
    );
    expect(productStyles.indexOf("soft-ui.css")).toBeGreaterThan(-1);
    expect(productStyles.indexOf("styles.css")).toBeGreaterThan(productStyles.indexOf("soft-ui.css"));
    const shell = readFileSync(join(__dirname, "..", "..", "components", "app-shell.tsx"), "utf8");
    expect(shell).toMatch(/product-styles/);
    const theme = readFileSync(join(__dirname, "..", "..", "app", "theme-provider.tsx"), "utf8");
    expect(theme).toMatch(/dynamic\(\(\) => import\("\.\.\/components\/app-shell"\)/);
    expect(theme).not.toMatch(/import AppShell from/);
    const signIn = readFileSync(join(__dirname, "..", "..", "app", "sign-in", "sign-in-client.tsx"), "utf8");
    expect(signIn).toMatch(/product-styles/);
    const kiosk = readFileSync(join(__dirname, "..", "..", "app", "display", "kiosk", "kiosk-client.tsx"), "utf8");
    expect(kiosk).toMatch(/product-styles/);
    const offline = readFileSync(join(__dirname, "..", "..", "app", "offline", "offline-client.tsx"), "utf8");
    expect(offline).toMatch(/product-styles/);
    const showcase = readFileSync(
      join(__dirname, "..", "..", "app", "showcase", "present", "presentation-client.tsx"),
      "utf8",
    );
    expect(showcase).toMatch(/product-styles/);
  });
});
