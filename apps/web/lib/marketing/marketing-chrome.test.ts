import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

function src(rel: string) {
  return readFileSync(join(WEB, rel), "utf8");
}

describe("marketing chrome", () => {
  it("landing hero has one primary CTA and a sign-in text link", () => {
    const page = src("app/page.tsx");
    expect(page).toMatch(/export const revalidate = 86_400/);
    // Slice the hero section, not the imports at the top of the file.
    const heroStart = page.indexOf('className="mx-hero"');
    const heroEnd = page.indexOf("<SeasonOverview");
    expect(heroStart).toBeGreaterThan(-1);
    expect(heroEnd).toBeGreaterThan(heroStart);
    const hero = page.slice(heroStart, heroEnd);
    expect(hero).toMatch(/<MarketingHeroActions \/>/);
    expect(hero).not.toMatch(/mx-btn|button secondary/);
    expect(hero).not.toMatch(/Request access/);
    const actions = src("components/marketing/site-header.tsx");
    const links = src("lib/marketing/account-links.ts");
    expect(actions).toMatch(/MarketingHeroActions/);
    expect(links).toMatch(/Join the waitlist/);
    expect(links).toMatch(/Already invited\? Sign in/);
    expect(links).toMatch(/Open your team/);
    expect(links).toMatch(/href: "\/dashboard"/);
  });

  it("tells the season once, in order, without fake metrics", () => {
    const page = src("app/page.tsx");
    const order = ["<SeasonOverview", "<DepthSections", "<TrustSection", "<FAQ", "<WaitlistSection"].map((tag) =>
      page.indexOf(tag),
    );
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const sections = src("components/marketing/home-sections.tsx");
    for (const part of ["Plan", "Scout", "Build", "Learn"]) expect(sections).toContain(`title: "${part}"`);
    for (const file of ["components/marketing/home-sections.tsx", "components/marketing/illustrations.tsx"]) {
      const text = src(file);
      expect(text).not.toMatch(/\b\d{2,}%|\b\d{3,}\s+teams\b|trusted by|rated \d|\d\.\d stars/i);
    }
  });

  it("labels every product illustration as an example and hides it from assistive technology", () => {
    const art = src("components/marketing/illustrations.tsx");
    const figures = art.match(/<figure\b/g) ?? [];
    const captions = art.match(/<Caption>[^<]*example/gi) ?? [];
    expect(figures.length).toBeGreaterThanOrEqual(5);
    expect(captions).toHaveLength(figures.length);
    expect(art.match(/aria-hidden="true"/g)?.length).toBe(figures.length);
    // No real FRC team numbers in a drawing: teams are lettered.
    expect(art).not.toMatch(/\b(?:frc)?\d{3,4}\b(?!\))/i);
    // Nothing inside a drawing can take focus.
    expect(art).not.toMatch(/<(?:a|button|input)\b/);
  });

  it("public previews disclose their purpose without invented data or inaccessible links", () => {
    const frames = src("components/marketing/app-frames.tsx");
    expect(frames).toContain("Product overview");
    expect(frames).toContain("Workflow overview");
    expect(frames).toContain("href={hub.href}");
    expect(frames).not.toMatch(/Chance (we win|to win)|mk-hero-win|mk-shape-win|width:.*%/);
    for (const route of ["features", "for-teams", "workflow", "features/strategy"]) {
      expect(src(`app/${route}/page.tsx`)).not.toContain('className="lux-route-hero-visual" aria-hidden="true"');
    }
  });

  it("describes current costs consistently in machine-readable offers", () => {
    const seo = src("lib/marketing/seo.ts");
    expect(seo).toContain("Vantage has no subscription charge");
    expect(seo).toContain("external provider charges are separate");
    expect(seo).not.toContain("Paid plans add Vantage-hosted AI");
  });

  it("pricing and for-teams keep one hero primary and point leftover to waitlist or sign-in", () => {
    const pricing = src("app/pricing/page.tsx");
    const forTeams = src("app/for-teams/page.tsx");
    expect(pricing).toMatch(/Join the waitlist/);
    expect(pricing).not.toMatch(/\/team\/ai-keys/);
    expect(pricing).not.toMatch(/Request access/);
    expect(forTeams).not.toMatch(/\bSame org\b/);
    expect(forTeams).not.toMatch(/Start free/);
    expect(forTeams).toMatch(/MarketingRouteActions/);
    expect(src("components/marketing/site-header.tsx")).toMatch(/Already invited\? Sign in/);
  });

  it("gives the phone menu one pinned action, a focus trap, Escape, a scrim and a scroll lock", () => {
    const header = src("components/marketing/site-header.tsx");
    expect(header).toMatch(/role="dialog"/);
    expect(header).toMatch(/aria-modal="true"/);
    expect(header).toMatch(/aria-expanded=\{menu\.open\}/);
    expect(header).toMatch(/event\.key === "Escape"/);
    expect(header).toMatch(/event\.key !== "Tab"/);
    expect(header).toMatch(/className="mx-menu-scrim"[^>]*onClick/);
    expect(header).toMatch(/root\.style\.overflow = "hidden"/);
    expect(header).toMatch(/buttonRef\.current\?\.focus/);
    const foot = header.slice(header.indexOf('className="mx-menu-foot"'), header.indexOf("export function SiteFooter"));
    expect(foot.match(/className="mx-btn"/g)).toHaveLength(1);
  });
});
