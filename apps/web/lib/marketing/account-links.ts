export type MarketingAccountLink = {
  href: string;
  label: string;
  primary?: boolean;
};

/** Header actions. Guests join the waitlist. A signed-in member opens the team. */
export function marketingHeaderLinks(signedIn: boolean): MarketingAccountLink[] {
  if (signedIn) {
    return [{ href: "/dashboard", label: "Open your team", primary: true }];
  }
  return [
    { href: "/signin", label: "Sign in" },
    { href: "/#waitlist", label: "Join waitlist", primary: true },
  ];
}

/** Hero actions on the public homepage. */
export function marketingHeroLinks(signedIn: boolean): MarketingAccountLink[] {
  if (signedIn) {
    return [{ href: "/dashboard", label: "Open your team", primary: true }];
  }
  return [
    { href: "#waitlist", label: "Join the waitlist", primary: true },
    { href: "/signin", label: "Already invited? Sign in" },
  ];
}

/** Footer account link. The waitlist link stays for guests who want to share it. */
export function marketingFooterAccountLink(signedIn: boolean): MarketingAccountLink {
  if (signedIn) return { href: "/dashboard", label: "Open your team" };
  return { href: "/signin", label: "Sign in" };
}

/** Primary button on a marketing route. Guests join the waitlist. Members open the team. */
export function marketingRoutePrimary(
  signedIn: boolean,
  guest?: { href?: string; label?: string },
): MarketingAccountLink {
  if (signedIn) return { href: "/dashboard", label: "Open your team", primary: true };
  return {
    href: guest?.href ?? "/#waitlist",
    label: guest?.label ?? "Join the waitlist",
    primary: true,
  };
}

/** Desktop page web action beside an optional Windows download. */
export function marketingDesktopWebLink(signedIn: boolean): MarketingAccountLink {
  if (signedIn) return { href: "/dashboard", label: "Open your team", primary: true };
  return { href: "/signin", label: "Sign in on the web", primary: true };
}
