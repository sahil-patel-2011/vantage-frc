import { describe, expect, it } from "vitest";
import { pathnameUsesAppShell } from "./product-route";

describe("pathnameUsesAppShell", () => {
  it("keeps marketing, sign-in, and the offline boot shell-free", () => {
    expect(pathnameUsesAppShell("/")).toBe(false);
    expect(pathnameUsesAppShell("/pricing")).toBe(false);
    expect(pathnameUsesAppShell("/features/cad")).toBe(false);
    expect(pathnameUsesAppShell("/signin")).toBe(false);
    expect(pathnameUsesAppShell("/sign-in")).toBe(false);
    expect(pathnameUsesAppShell("/offline")).toBe(false);
  });

  it("keeps pit TV, showcase present, public forms, and sponsor storefronts shell-free", () => {
    expect(pathnameUsesAppShell("/display/kiosk")).toBe(false);
    expect(pathnameUsesAppShell("/display/kiosk/abc")).toBe(false);
    expect(pathnameUsesAppShell("/display/pit")).toBe(false);
    expect(pathnameUsesAppShell("/showcase/present")).toBe(false);
    expect(pathnameUsesAppShell("/support/acme")).toBe(false);
    expect(pathnameUsesAppShell("/f/0123456789abcdef0123456789abcdef")).toBe(false);
  });

  it("mounts the drawer on product hubs and signed-in support tickets", () => {
    expect(pathnameUsesAppShell("/dashboard")).toBe(true);
    expect(pathnameUsesAppShell("/team")).toBe(true);
    expect(pathnameUsesAppShell("/support")).toBe(true);
    expect(pathnameUsesAppShell("/invite")).toBe(true);
    expect(pathnameUsesAppShell("/onboarding")).toBe(true);
  });
});
