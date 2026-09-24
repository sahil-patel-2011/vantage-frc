"use client";

import { createContext } from "react";

/**
 * Whether Home's first widget data has arrived. Before it has, a card with no
 * payload is waiting, not empty; after it, no payload means the card has
 * nothing to show. Outside Home (and in tests) cards count as loaded.
 */
export const WidgetsLoadedContext = createContext(true);
