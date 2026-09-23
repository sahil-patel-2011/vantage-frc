import "../../app/marketing.css";
import "../../app/marketing-v3.css";
import "../../app/vantage-scan-marketing.css";
// Final visual pass. Marketing half only — see product-styles.ts for the other.
import "../../app/apple-polish-marketing.css";
// Layout fixes and motion, after everything else so it wins ties.
import "../../app/marketing-motion.css";

/** Side-effect module: marketing pages import this so product routes do not. */
export {};
