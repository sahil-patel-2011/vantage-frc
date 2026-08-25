"use client";

import { usePathname } from "next/navigation";
import Image from "next/image";

const links = [
  ["/features", "Product"],
  ["/workflow", "How it works"],
  ["/desktop", "Desktop"],
  ["/pricing", "Pricing"],
] as const;

export function BrandLink({ href = "/" }: { href?: string }) {
  return (
    <a className="wordmark" href={href} aria-label="Vantage home">
      <Image src="/vantage-logo.svg" alt="Vantage" width={150} height={30} priority />
    </a>
  );
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="nav">
      <BrandLink />
      <nav aria-label="Primary navigation">
        {links.map(([href, label]) => (
          <a
            aria-current={
              pathname === href || (href === "/features" && pathname.startsWith("/features/"))
                ? "page"
                : undefined
            }
            href={href}
            key={href}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="nav-actions">
        <a className="sign-in-link" href="/signin">
          Sign in
        </a>
        <a className="button compact waitlist-nav" href="/#waitlist">
          Join waitlist
        </a>
      </div>
    </header>
  );
}

const footerColumns = [
  {
    title: "Product",
    links: [
      ["/features", "Product"],
      ["/workflow", "How it works"],
      ["/desktop", "Desktop"],
      ["/pricing", "Pricing"],
      ["/for-teams", "For teams"],
    ],
  },
  {
    title: "Access",
    links: [
      ["/signin", "Sign in"],
      ["/#waitlist", "Waitlist"],
      ["mailto:hello@vantagefrc.com", "Contact"],
    ],
  },
  {
    title: "Legal",
    links: [
      ["/privacy", "Privacy"],
      ["/terms", "Terms"],
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-brand">
        <BrandLink />
        <p>Competition operations for FRC teams.</p>
      </div>
      <nav className="marketing-footer-cols" aria-label="Footer">
        {footerColumns.map((col) => (
          <div className="marketing-footer-col" key={col.title}>
            <b>{col.title}</b>
            {col.links.map(([href, label]) => (
              <a href={href} key={`${href}-${label}`}>
                {label}
              </a>
            ))}
          </div>
        ))}
      </nav>
    </footer>
  );
}
