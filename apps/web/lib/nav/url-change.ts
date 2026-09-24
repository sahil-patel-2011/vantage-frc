/**
 * Fired on window after code rewrites the address with history.replaceState (a hub switching
 * tabs in place). Nothing else notices such a change, so the app frame listens for this to
 * keep its bottom tab bar on the right tab.
 */
export const URL_CHANGE_EVENT = "vantage:urlchange";
