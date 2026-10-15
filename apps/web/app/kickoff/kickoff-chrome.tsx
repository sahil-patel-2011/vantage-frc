"use client";

import { useEffect, useState } from "react";

export function useHubEmbed(): "build" | null {
  const [embed, setEmbed] = useState<"build" | null>(null);
  useEffect(() => {
    if (window.location.pathname.startsWith("/build")) setEmbed("build");
    else setEmbed(null);
  }, []);
  return embed;
}
