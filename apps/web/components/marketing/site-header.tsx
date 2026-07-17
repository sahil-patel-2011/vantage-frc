"use client";

import { usePathname } from "next/navigation";
import Image from "next/image";

const links = [
  ["/features", "Showcase"],
  ["/workflow", "Workflow"],
  ["/features/cad", "AI CAD"],
  ["/features/code", "Code"],
  ["/features/strategy", "Assistant"],
  ["/pricing", "Pricing"],
] as const;

export function BrandLink({ href = "/" }: { href?: string }) {
  return <a className="wordmark" href={href} aria-label="Vantage home"><Image src="/vantage-logo.svg" alt="Vantage" width={150} height={30} priority /></a>;
}

export function SiteHeader() {
  const pathname = usePathname();
  const nav = (mobile = false) => links.map(([href, label]) => (
    <a
      aria-current={pathname === href || (href === "/features" && pathname.startsWith("/features/") && !links.some(([otherHref]) => otherHref !== "/features" && otherHref === pathname)) ? "page" : undefined}
      href={href}
      key={href}
      onClick={mobile ? (event) => (event.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open") : undefined}
    >
      {label}
    </a>
  ));

  return (
    <header className="nav">
      <BrandLink />
      <nav aria-label="Primary navigation">{nav()}</nav>
      <div className="nav-actions"><a className="sign-in-link" href="/signin">Sign in</a><a className="button compact waitlist-nav" href="/#hero-email">Join waitlist</a></div>
      <details className="mobile-menu">
        <summary aria-label="Open navigation"><span /><span /><span /></summary>
        <nav aria-label="Mobile navigation">{nav(true)}<a href="/signin">Sign in</a><a href="/#hero-email">Join waitlist</a></nav>
      </details>
    </header>
  );
}

export function SiteFooter() {
  return <footer className="marketing-footer"><BrandLink /><p>Vantage FRC — competition operations software for FIRST Robotics Competition teams.</p><nav><a href="/pricing">Pricing</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:hello@vantagefrc.com">Contact</a></nav></footer>;
}
