# iOS PWA and future wrapper checklist

Vantage is currently a PWA and does not claim App Store approval.

- Mobile layouts support portrait/landscape, safe-area insets, 16px inputs, 44px targets, 200% zoom, reduced motion, keyboard-safe sticky controls, visible labels/live regions, high contrast, and offline/reconnect status.
- Phone gestures are enabled only when both a narrow viewport and coarse pointer match. Gesture starts avoid system edges, respect scroll direction, require deliberate distance/velocity, and always have a visible button alternative. Destructive swipe actions require confirmation/undo.
- PWA metadata/icons, standalone behavior, install guidance, service-worker/IndexedDB recovery, iOS storage eviction, and poor-connectivity behavior require WebKit regression coverage before release.
- TV setup remains phone-usable; kiosk presentation remains TV/desktop optimized.
- A native wrapper must provide working privacy policy, account deletion, data export, and support links. Subscription flows must be reviewed against the current App Store Review Guidelines and may require Apple in-app purchase. Web Stripe checkout must not be assumed acceptable inside a native wrapper.
- Before submission, re-review current Apple App Review Guidelines and Human Interface Guidelines; document privacy nutrition labels, data retention, encryption/export controls, sign-in requirements, accessibility, and reviewer test credentials.
