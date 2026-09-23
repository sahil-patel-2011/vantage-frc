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
