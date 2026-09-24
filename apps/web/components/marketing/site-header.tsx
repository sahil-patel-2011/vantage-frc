"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { fetchProductSession } from "../../lib/nav/product-session";
import {
  marketingDesktopWebLink,
  marketingFooterAccountLink,
  marketingHeaderLinks,
  marketingHeroLinks,
  marketingRoutePrimary,
  marketingShowsAdminLink,
} from "../../lib/marketing/account-links";
import "./marketing-styles";

const links = [
  ["/features", "Features"],
  ["/workflow", "How it works"],
  ["/for-teams", "For teams"],
  // Named "Free", not "Pricing": a "Pricing" tab tells a mentor the opposite of the answer,
  // but the cost question still needs a place in the nav (it was only in the footer).
  ["/pricing", "Cost"],
] as const;

export function BrandLink({ href = "/" }: { href?: string }) {
  return (
    <a className="wordmark" href={href} aria-label="Vantage home">
      <Image src="/vantage-logo.svg" alt="Vantage" width={150} height={30} priority />
    </a>
  );
}

function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetchProductSession().then((session) => {
      if (!cancelled) setSignedIn(session?.authenticated === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return signedIn;
}

function closeMobileMenu(event: { currentTarget: Element }) {
  (event.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
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
    void fetchProductSession().then((session) => {
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

export function MarketingHeroActions() {
  const signedIn = useSignedIn();
  return (
    <div className="actions">
      {marketingHeroLinks(signedIn).map((link) =>
        link.primary ? (
          <a className="button primary" href={link.href} key={link.label}>
            {link.label}
          </a>
        ) : (
          <a className="text-link" href={link.href} key={link.label}>
            {link.label}
          </a>
        ),
      )}
    </div>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const signedIn = useSignedIn();
  const account = marketingHeaderLinks(signedIn);
  // The phone menu is a <details>: it stayed open over the page until its button was tapped
  // again. Escape and a tap anywhere outside it close it too.
  useEffect(() => {
    const menu = () => document.querySelector<HTMLDetailsElement>("header.nav details.mobile-menu");
    const onKey = (event: KeyboardEvent) => {
      const open = menu();
      if (event.key !== "Escape" || !open?.open) return;
      open.open = false;
      open.querySelector("summary")?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const open = menu();
      if (open?.open && !open.contains(event.target as Node)) open.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);
  const nav = (mobile = false) =>
    links.map(([href, label]) => (
      <a
        aria-current={
          pathname === href || (href === "/features" && pathname.startsWith("/features/"))
            ? "page"
            : undefined
        }
        href={href}
        key={href}
        onClick={mobile ? closeMobileMenu : undefined}
      >
        {label}
      </a>
    ));

  return (
    <header className="nav">
      <BrandLink />
      <nav aria-label="Primary navigation">{nav()}</nav>
      <div className="nav-actions">
        {account.map((link) =>
          link.primary ? (
            <a
              className={link.href === "/#waitlist" ? "button compact waitlist-nav" : "button compact"}
              href={link.href}
              key={link.label}
            >
              {link.label}
            </a>
          ) : (
            <a className="sign-in-link" href={link.href} key={link.label}>
              {link.label}
            </a>
          ),
        )}
      </div>
      <details className="mobile-menu">
        <summary aria-label="Open navigation">
          <span />
          <span />
          <span />
        </summary>
        <nav aria-label="Mobile navigation">
          {nav(true)}
          {account.map((link) => (
            <a href={link.href} key={link.label} onClick={closeMobileMenu}>
              {link.label}
            </a>
          ))}
        </nav>
      </details>
    </header>
  );
}

export function SiteFooter() {
  const account = marketingFooterAccountLink(useSignedIn());
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-brand">
        <BrandLink />
        <p>Free software for FRC teams — scouting, strategy, build and business in one login.</p>
      </div>
      <div className="marketing-footer-cols">
        <nav className="marketing-footer-col" aria-label="Product">
          <b>Product</b>
          {/* The same names as the top menu: "Product", "How it works", "For teams", "Free". */}
          <a href="/features">Features</a>
          <a href="/workflow">How it works</a>
          <a href="/for-teams">For teams</a>
          <a href="/pricing">Cost</a>
        </nav>
        <nav className="marketing-footer-col" aria-label="Company">
          <b>Company</b>
          <a href={account.href}>{account.label}</a>
          <a href="/#waitlist">Waitlist</a>
          <a href="mailto:vantagefrc@gmail.com">Contact</a>
        </nav>
        <nav className="marketing-footer-col" aria-label="Legal">
          <b>Legal</b>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </div>
    </footer>
  );
}
