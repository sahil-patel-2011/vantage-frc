/**
 * The script that picks light or dark before the first frame.
 *
 * It is a raw inline <script> in <head> (app/layout.tsx), so the browser runs it while parsing,
 * before <body> is painted. It used to be a next/script `beforeInteractive` inside <body>. In the
 * App Router that only queues the code for Next's runtime to run later, so a dark-mode user got a
 * light first frame on almost every hard load.
 *
 * Order: an explicit choice (cookie, then this device's storage) wins; "system" and no choice at
 * all follow the device. A browser that never chose used to get light even with the OS in dark,
 * although Account → Appearance says "System follows your device".
 */
export const THEME_PREFERENCE_COOKIE = "vantage-theme-pref";

export const THEME_BOOTSTRAP_SCRIPT = `(function(){var d=document.documentElement;function os(){try{return window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}catch(e){return "light";}}var t;try{var p=(document.cookie.match(/(?:^|; )vantage-theme-pref=(light|dark|system)/)||[])[1]||localStorage.getItem("vantage-theme-pref");if(p==="light"||p==="dark"){t=p;}else if(p==="system"){t=os();}else{var c=(document.cookie.match(/(?:^|; )vantage-theme=(light|dark)/)||[])[1]||localStorage.getItem("vantage-theme");t=c==="light"||c==="dark"?c:os();}}catch(e){t=os();}d.dataset.theme=t;d.style.colorScheme=t;})();`;
