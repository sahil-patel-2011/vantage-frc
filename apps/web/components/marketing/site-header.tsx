"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { fetchProductSession } from "../../lib/nav/product-session";
import {
  marketingFooterAccountLink,
  marketingHeaderLinks,
  marketingHeroLinks,
} from "../../lib/marketing/account-links";
import "./marketing-styles";

const links = [
  ["/features", "Product"],
  ["/workflow", "How it works"],
  // "What it costs", not "Pricing". The page leads with the software being
  // free; a link reading "Pricing" tells a mentor the opposite before they have
  // read a word. The footer already says this — the header now agrees with it.
  ["/pricing", "What it costs"],
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
        <p>Competition operations for FRC teams. Invite-only.</p>
      </div>
      <div className="marketing-footer-cols">
        <nav className="marketing-footer-col" aria-label="Product">
          <b>Product</b>
          <a href="/features">Hubs and tools</a>
          <a href="/workflow">How it works</a>
          <a href="/for-teams">For teams</a>
          <a href="/desktop">Desktop</a>
        </nav>
        <nav className="marketing-footer-col" aria-label="Company">
          <b>Company</b>
          <a href="/pricing">What it costs</a>
          <a href={account.href}>{account.label}</a>
          <a href="/#waitlist">Waitlist</a>
          <a href="mailto:sahiljpatel2011@gmail.com">Contact</a>
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
