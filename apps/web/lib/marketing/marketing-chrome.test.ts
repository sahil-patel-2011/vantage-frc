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
    // Slice the hero section, not the HomeShowcase import at the top of the file.
    const heroStart = page.indexOf('className="lux-hero"');
    const heroEnd = page.indexOf("<HomeShowcase");
    expect(heroStart).toBeGreaterThan(-1);
    expect(heroEnd).toBeGreaterThan(heroStart);
    const hero = page.slice(heroStart, heroEnd);
    expect(hero.match(/className="button primary"/g)).toHaveLength(1);
    expect(hero).toMatch(/Join the waitlist/);
    expect(hero).toMatch(/Already invited\? Sign in/);
    expect(hero).not.toMatch(/button secondary/);
    expect(hero).not.toMatch(/Request access/);
  });

  it("does not dump dashboard routes or fake metrics on the public story", () => {
    const showcase = src("components/marketing/home-showcase.tsx");
    expect(showcase).not.toMatch(/mk-tag/);
    expect(showcase).toMatch(/MARKETING_STUDENT_PATH/);
    expect(showcase).not.toMatch(/\b\d{2,}%\b|\b\d{3,}\s+teams\b/i);
  });

  it("pricing and for-teams keep one hero primary and point leftover to waitlist or sign-in", () => {
    const pricing = src("app/pricing/page.tsx");
    const forTeams = src("app/for-teams/page.tsx");
    expect(pricing).toMatch(/Join the waitlist/);
    expect(pricing).not.toMatch(/\/team\/ai-keys/);
    expect(pricing).not.toMatch(/Request access/);
    expect(forTeams).not.toMatch(/\bSame org\b/);
    expect(forTeams).not.toMatch(/Start free/);
    expect(forTeams).toMatch(/Already invited\? Sign in/);
  });
});
