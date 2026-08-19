/**
 * Legacy path → Soft-UI hub tab. Destinations that already include `?tab=`
 * would otherwise drop inbound `orgId` (Next overwrites the query).
 */

export type LegacyRedirect = {
  source: string;
  destination: string;
};

export type ExpandedRedirect = {
  source: string;
  destination: string;
  permanent: false;
  has?: Array<{ type: "query"; key: string; value: string }>;
};

export const LEGACY_HUB_REDIRECTS: LegacyRedirect[] = [
  { source: "/knowledge", destination: "/team?tab=knowledge" },
  { source: "/knowledge/:path*", destination: "/team?tab=knowledge" },
  { source: "/repairs", destination: "/incidents" },
  { source: "/repairs/:path*", destination: "/incidents" },
  { source: "/meetings", destination: "/team?tab=calendar" },
  { source: "/meetings/:path*", destination: "/team?tab=calendar" },
  { source: "/config", destination: "/robot" },
  { source: "/config/:path*", destination: "/robot" },
  { source: "/changes", destination: "/decisions" },
  { source: "/changes/:path*", destination: "/decisions" },
  { source: "/command", destination: "/competition?tab=command" },
  { source: "/my-day", destination: "/competition?tab=my-day" },
  { source: "/strategy", destination: "/competition?tab=strategy" },
  { source: "/scouting", destination: "/competition?tab=scouting" },
  { source: "/pick-clock", destination: "/competition?tab=pick-clock" },
  { source: "/chemistry", destination: "/competition?tab=chemistry" },
  { source: "/todos", destination: "/team?tab=todos" },
  { source: "/messages", destination: "/team?tab=messages" },
  { source: "/practice", destination: "/team?tab=practice" },
  { source: "/attendance", destination: "/team?tab=attendance" },
  { source: "/team/calendar", destination: "/team?tab=calendar" },
  { source: "/team/knowledge", destination: "/team?tab=knowledge" },
  { source: "/orders", destination: "/business?tab=orders" },
  { source: "/sponsorship", destination: "/business?tab=sponsorship" },
  { source: "/kickoff", destination: "/build?tab=kickoff" },
  { source: "/cad", destination: "/build?tab=cad" },
  { source: "/code", destination: "/build?tab=code" },
  { source: "/fmea", destination: "/build?tab=fmea" },
  { source: "/prototype-tracker", destination: "/build?tab=prototype" },
  { source: "/batteries", destination: "/build?tab=batteries" },
  { source: "/chat", destination: "/ai?tab=chat" },
  { source: "/team/budgets", destination: "/ai?tab=budgets" },
  { source: "/team/ai-policy", destination: "/ai?tab=governance" },
  { source: "/writer", destination: "/ai?tab=writer" },
  { source: "/team/ai-memory", destination: "/ai?tab=memory" },
  { source: "/travel", destination: "/logistics" },
  { source: "/travel/:path*", destination: "/logistics" },
  { source: "/help", destination: "/docs" },
  { source: "/help/:slug", destination: "/docs/:slug" },
  { source: "/pit-tv", destination: "/display/pit" },
];

/** Next.js overwrites the request query when the destination already has one. */
export function expandLegacyRedirects(entries: LegacyRedirect[] = LEGACY_HUB_REDIRECTS): ExpandedRedirect[] {
  return entries.flatMap(({ source, destination }) => {
    if (!destination.includes("?")) {
      return [{ source, destination, permanent: false as const }];
    }
    const join = destination.includes("?") ? "&" : "?";
    return [
      {
        source,
        has: [{ type: "query" as const, key: "orgId", value: "(?<orgId>[^&]+)" }],
        destination: `${destination}${join}orgId=:orgId`,
        permanent: false as const,
      },
      { source, destination, permanent: false as const },
    ];
  });
}
