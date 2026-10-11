"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { fetchProductSession } from "../../lib/nav/product-session";
import { probeSessionUser } from "../../lib/nav/session-probe";
import {
  marketingDesktopWebLink,
  marketingFooterAccountLink,
  marketingHeaderLinks,
  marketingHeroLinks,
  marketingRoutePrimary,
  marketingShowsAdminLink,
} from "../../lib/marketing/account-links";
import "./marketing-styles";
import { usePublicSignupOpen } from "./launch-availability";

const links = [
  ["/features", "Features"],
  ["/workflow", "How it works"],
  ["/for-teams", "For teams"],
  // Named "Cost", not "Pricing": a "Pricing" tab tells a mentor the opposite of the answer,
  // but the cost question still needs a place in the nav (it was only in the footer). The page
  // is "Cost" in the menu, the footer and its title; /cost reaches it too (proxy.ts).
  ["/pricing", "Cost"],
] as const;

/** At this width the header shows its links and the phone menu goes away (marketing-site.css). */
const WIDE_HEADER = "(min-width: 960px)";

export function BrandLink({ href = "/" }: { href?: string }) {
  return (
    <a className="wordmark" href={href} aria-label="Vantage home">
      <Image src="/vantage-logo.svg" alt="Vantage" width={150} height={30} priority />
    </a>
  );
}

/**
 * Whether this browser holds a session, asked of the auth route a visitor may call.
 * `/api/me` answers a signed-out visitor with 401, and the browser printed that as a
 * console error on every public page. One request per page load, shared by every link.
 */
function hasSession(): Promise<boolean> {
  // Shared with the consent banner, so a public page asks once.
  return probeSessionUser().then((user) => Boolean(user));
}

function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void hasSession().then((yes) => {
      if (!cancelled) setSignedIn(yes);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return signedIn;
}

export function MarketingAccountTextLink() {
  const signedIn = useSignedIn();
  const link = marketingFooterAccountLink(signedIn);
  return <a href={link.href}>{link.label}</a>;
}

export function MarketingInvitedNote({
  lead,
  className = "lux-hero-note",
}: {
  lead?: string;
  className?: string;
}) {
  const signedIn = useSignedIn();
  return (
    <p className={className || undefined}>
      {lead ? <>{lead} </> : null}
      {signedIn ? (
        <a href="/dashboard">Open your team</a>
      ) : (
        <>
          Already invited? <a href="/signin">Sign in</a>
        </>
      )}
      {" · "}
      Questions? <a href="mailto:vantagefrc@gmail.com">vantagefrc@gmail.com</a>
    </p>
  );
}

/** The older public pages' hero actions (workflow, for-teams, the deep dives). */
export function MarketingRouteActions({
  className = "actions",
  guestLabel = "Join the waitlist",
  guestHref = "/#waitlist",
  signIn = false,
  companion,
}: {
  className?: string;
  guestLabel?: string;
  guestHref?: string;
  /** Guest-only text link. Hidden once a session exists. */
  signIn?: boolean;
  companion?: { href: string; label: string; variant?: "text" | "secondary" };
}) {
  const signedIn = useSignedIn();
  const primary = marketingRoutePrimary(signedIn, { href: guestHref, label: guestLabel });
  return (
    <div className={className}>
      <a className="button primary" href={primary.href}>
        {primary.label}
      </a>
      {signIn && !signedIn ? (
        <a className="text-link" href="/signin">
          Already invited? Sign in
        </a>
      ) : null}
      {companion ? (
        <a
          className={companion.variant === "secondary" ? "button secondary" : "text-link"}
          href={companion.href}
        >
          {companion.label}
        </a>
      ) : null}
    </div>
  );
}

/**
 * The rebuilt pages' actions: one filled button (the waitlist for a guest, the team for a member,
 * account creation once signup opens) and at most one quiet link beside it.
 */
export function MarketingPageActions({
  guestLabel = "Join the waitlist",
  companion,
}: {
  guestLabel?: string;
  companion?: { href: string; label: string };
}) {
  const signedIn = useSignedIn();
  const signupOpen = usePublicSignupOpen();
  const header = marketingHeaderLinks(signedIn, signupOpen).find((link) => link.primary);
  const primary = !signedIn && !signupOpen ? { href: "/#waitlist", label: guestLabel } : header;
  return (
    <div className="mx-actions">
      {primary ? (
        <a className="mx-btn" href={primary.href}>
          {primary.label}
        </a>
      ) : null}
      {companion ? (
        <a className="mx-link" href={companion.href}>
          {companion.label}
        </a>
      ) : null}
    </div>
  );
}

/** Plan-card link. Guests join the waitlist. A signed-in member opens the team. */
export function MarketingPlanLink({ guestLabel }: { guestLabel?: string }) {
  const link = marketingRoutePrimary(useSignedIn(), guestLabel ? { label: guestLabel } : undefined);
  return (
    <a className="text-link" href={link.href}>
      {link.label}
    </a>
  );
}

/** Owner or admin settings link. Everyone else gets the plan link instead. */
export function MarketingAdminLink({ href, label }: { href: string; label: string }) {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void hasSession()
      .then((yes) => (yes ? fetchProductSession() : null))
      .then((session) => {
        if (!cancelled) setAdmin(marketingShowsAdminLink(session?.role));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!admin) return <MarketingPlanLink />;
  return (
    <a className="text-link" href={href}>
      {label}
    </a>
  );
}

export function MarketingDesktopWebLink({ primary }: { primary: boolean }) {
  const web = marketingDesktopWebLink(useSignedIn());
  return (
    <a className={`button ${primary ? "primary" : "secondary"}`} href={web.href}>
      {web.label}
    </a>
  );
}

/** Home hero: one filled button and one quiet link (sign in, for people who were invited). */
export function MarketingHeroActions() {
  const signedIn = useSignedIn();
  const signupOpen = usePublicSignupOpen();
  return (
    <div className="mx-actions">
      {marketingHeroLinks(signedIn, signupOpen).map((link) =>
        link.primary ? (
          <a className="mx-btn" href={link.href} key={link.label}>
            {link.label}
          </a>
        ) : (
          <a className="mx-link" href={link.href} key={link.label}>
            {link.label}
          </a>
        ),
      )}
    </div>
  );
}

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || (href === "/features" && pathname.startsWith("/features/"));
}

/**
 * The phone and tablet menu: a sheet from the right over a scrim. The page links are one list;
 * the one action (the waitlist, the team, or account creation) is pinned at the bottom, in thumb
 * reach. While it is open, focus stays inside it, the page behind does not scroll, and Escape, the
 * scrim, the close button or a link closes it; focus then goes back to the menu button.
 */
function useMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const panel = panelRef.current;
    const focusable = () =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")) : [];
    // The first page link, not the close button: that is what someone opening a menu came for.
    const first = panel?.querySelector<HTMLElement>(".mx-menu-links a") ?? focusable()[0];
    first?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = panel?.contains(active) ?? false;
      if (event.shiftKey && (active === head || !inside)) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && (active === tail || !inside)) {
        event.preventDefault();
        head.focus();
      }
    };
    // Turning a tablet to landscape can make the header wide enough to show its own links.
    const wide = window.matchMedia(WIDE_HEADER);
    const onWide = () => {
      if (wide.matches) close(false);
    };
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      root.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open, close]);

  return { open, setOpen, close, buttonRef, panelRef };
}

export function SiteHeader() {
  const pathname = usePathname() ?? "";
  const signedIn = useSignedIn();
  const signupOpen = usePublicSignupOpen();
  const account = marketingHeaderLinks(signedIn, signupOpen);
  const primary = account.find((link) => link.primary);
  const secondary = account.find((link) => !link.primary);
  const menu = useMenu();
  const menuId = useId();
  const titleId = `${menuId}-title`;

  return (
    <>
      <header className="mx-nav">
        <div className="mx-nav-inner">
          <BrandLink />
          <nav className="mx-nav-links" aria-label="Primary navigation">
            {links.map(([href, label]) => (
              <a aria-current={isCurrent(pathname, href) ? "page" : undefined} href={href} key={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="mx-nav-actions">
            {secondary ? (
              <a className="mx-nav-signin" href={secondary.href}>
                {secondary.label}
              </a>
            ) : null}
            {primary ? (
              <a className="mx-btn is-small" href={primary.href}>
                {primary.label}
              </a>
            ) : null}
            <button
              ref={menu.buttonRef}
              type="button"
              className="mx-menu-button"
              aria-label="Menu"
              aria-expanded={menu.open}
              aria-controls={menuId}
              onClick={() => menu.setOpen((value) => !value)}
            >
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
      {/* Outside the header: its backdrop blur would make it the box a fixed sheet is placed in. */}
      <div className={`mx-menu${menu.open ? " is-open" : ""}`} inert={!menu.open}>
        <div className="mx-menu-scrim" aria-hidden="true" onClick={() => menu.close()} />
        <div
          ref={menu.panelRef}
          id={menuId}
          className="mx-menu-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="mx-menu-top">
            <p className="mx-menu-title" id={titleId}>
              Menu
            </p>
            <button type="button" className="mx-menu-close" aria-label="Close menu" onClick={() => menu.close()} />
          </div>
          <nav className="mx-menu-links" aria-label="Mobile navigation">
            <a aria-current={pathname === "/" ? "page" : undefined} href="/" onClick={() => menu.close(false)}>
              Home
            </a>
            {links.map(([href, label]) => (
              <a
                aria-current={isCurrent(pathname, href) ? "page" : undefined}
                href={href}
                key={href}
                onClick={() => menu.close(false)}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="mx-menu-foot">
            {primary ? (
              <a className="mx-btn" href={primary.href} onClick={() => menu.close(false)}>
                {primary.label}
              </a>
            ) : null}
            {secondary ? (
              <p>
                Already invited?{" "}
                <a href={secondary.href} onClick={() => menu.close(false)}>
                  {secondary.label}
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

export function SiteFooter() {
  const account = marketingFooterAccountLink(useSignedIn());
  return (
    <footer className="mx-footer">
      <div className="mx-footer-inner">
        <div className="mx-footer-brand">
          <BrandLink />
          <p>The operations app for FRC teams. Plan, scout, build and learn together, free.</p>
        </div>
        <nav className="mx-footer-col" aria-label="Product">
          <b>Product</b>
          {/* The same names as the top menu: "Features", "How it works", "For teams", "Cost". */}
          <a href="/features">Features</a>
          <a href="/workflow">How it works</a>
          <a href="/for-teams">For teams</a>
          <a href="/pricing">Cost</a>
          <a href="/desktop">Desktop app</a>
        </nav>
        <nav className="mx-footer-col" aria-label="Account">
          <b>Account</b>
          <a href={account.href}>{account.label}</a>
          <a href="/#waitlist">Waitlist</a>
        </nav>
        {/* /contact lands here (proxy.ts). The address is written out, so a laptop with no mail
            app still shows where to write; /contact used to open a mailto: link and nothing else. */}
        <nav className="mx-footer-col" aria-label="Contact" id="contact">
          <b>Contact</b>
          <a href="mailto:vantagefrc@gmail.com">vantagefrc@gmail.com</a>
        </nav>
        <nav className="mx-footer-col" aria-label="Legal">
          <b>Legal</b>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </div>
      <div className="mx-footer-base">
        <p>Vantage is independent of FIRST and is not endorsed by FIRST.</p>
      </div>
    </footer>
  );
}
