import "./soft-ui.css";
import "./styles.css";
import "./vantage-scan/hubs.css";
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

/** Side-effect module: product shells import this so marketing routes do not. */
export {};
