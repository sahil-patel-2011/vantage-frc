import "./soft-ui.css";
import "./styles.css";
import "./vantage-scan/hubs.css";
// The tool strip, related-links strip and hub chips are used on standalone pages too
// (ToolStrip in /scouting, /inventory, /help …). Loaded only by hubs, those pages drew
// the chips as bare browser buttons (2px outset black). Every selector in it is scoped.
import "./product-hub.css";
// Last on purpose: vantage-chrome.css restyles the same selectors soft-ui.css
// defines (.soft-topbar, .soft-island, .soft-drawer) at equal specificity, so
// it has to come after them to win. Tokens live in vantage-fluid.css, loaded
// from the root layout so marketing routes get the easing curves too.
import "./vantage-chrome.css";
// Rail comes after chrome: it owns the body inset and the topbar offset.
import "./app-rail.css";
// Final visual pass: calm spacing, soft depth, cobalt actions. Product half only —
// its marketing twin lives in marketing-styles.ts so neither sheet is in two chunk groups.
import "./apple-polish-product.css";
// Toast and disclosure entrances, on the shared motion tokens.
import "./product-motion.css";

/** Side-effect module: product shells import this so marketing routes do not. */
export {};
