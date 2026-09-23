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
    // Slice the hero section, not the HomeShowcase import at the top of the file.
    const heroStart = page.indexOf('className="lux-hero"');
    const heroEnd = page.indexOf("<HomeShowcase");
    expect(heroStart).toBeGreaterThan(-1);
    expect(heroEnd).toBeGreaterThan(heroStart);
    const hero = page.slice(heroStart, heroEnd);
    expect(hero).toMatch(/<MarketingHeroActions \/>/);
    expect(hero).not.toMatch(/button secondary/);
    expect(hero).not.toMatch(/Request access/);
    const actions = src("components/marketing/site-header.tsx");
    const links = src("lib/marketing/account-links.ts");
    expect(actions).toMatch(/MarketingHeroActions/);
    expect(links).toMatch(/Join the waitlist/);
    expect(links).toMatch(/Already invited\? Sign in/);
    expect(links).toMatch(/Open your team/);
    expect(links).toMatch(/href: "\/dashboard"/);
  });

  it("does not dump dashboard routes or fake metrics on the public story", () => {
    const showcase = src("components/marketing/home-showcase.tsx");
    expect(showcase).not.toMatch(/mk-tag/);
    // The day-one path moved to /for-teams when the homepage was simplified;
    // the home story now carries the four-step loop instead.
    expect(showcase).toMatch(/MARKETING_LEARN/);
    expect(showcase).toMatch(/ProductFrame/);
    expect(showcase).toMatch(/MARKETING_APP_FRAMES/);
    expect(showcase).not.toMatch(/\b\d{2,}%\b|\b\d{3,}\s+teams\b/i);
  });

  it("hero and product frames show the real Kickoff brief, not a Good-evening mock", () => {
    const frames = src("components/marketing/app-frames.tsx");
    const hero = src("components/marketing/hero-product.tsx");
    expect(hero).toMatch(/export \{ HeroProductPanel \} from "\.\/app-frames"/);
    expect(frames).toMatch(/computeGameBrief/);
    expect(frames).toMatch(/gameBriefStatusBadge/);
    expect(frames).toMatch(/Ask about this game/);
    expect(frames).toMatch(/Needs setup/);
    expect(frames).toMatch(/Coverage stays blank until you scout/);
    expect(frames).not.toMatch(/never a fake/);
    expect(frames).toMatch(/Connect Claude Code/);
    expect(frames).toMatch(/CAD Video Tutor/);
    expect(src("app/marketing-showcase.css")).toMatch(/color:var\(--m-on-accent/);
    expect(frames).not.toMatch(/Good evening/);
    expect(frames).not.toMatch(/\b\d{2,}%\b|\b\d{3,}\s+teams\b/i);
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
});
