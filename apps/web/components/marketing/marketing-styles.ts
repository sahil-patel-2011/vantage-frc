import "../../app/marketing.css";
import "../../app/marketing-v3.css";
import "../../app/vantage-scan-marketing.css";
// Final visual pass. Marketing half only — see product-styles.ts for the other.
import "../../app/apple-polish-marketing.css";
// Layout fixes and motion, after everything else so it wins ties.
import "../../app/marketing-motion.css";
// The public site's one system (home, features, cost, header, menu, footer, waitlist). Last, so the
// older sheets above never decide how the rebuilt pages look.
import "../../app/marketing-site.css";

/** Side-effect module: marketing pages import this so product routes do not. */
export {};
