// Injects iOS PWA meta tags into the exported dist/index.html that
// app.json's "web" config has no key for (Expo Router's file-based
// +html.tsx customization needs web.output: "static", which isn't safe
// here since expo-sqlite's web backend relies on browser-only APIs during
// render). Run after `expo export -p web` -- see package.json "build".
const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "..", "dist", "index.html");
let html = fs.readFileSync(indexPath, "utf8");

const tags = [
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="Fia">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
].join("\n  ");

if (!html.includes("apple-mobile-web-app-capable")) {
  html = html.replace("</head>", `  ${tags}\n</head>`);
}

// NOTE: deliberately NOT setting maximum-scale/user-scalable=no here.
// Disabling pinch-zoom is a known source of iOS Safari getting stuck in a
// shifted/zoomed viewport state after a text input's keyboard dismisses --
// elements stay visually in place but stop being tappable there. That's
// worse than losing the "no accidental zoom" nicety.
html = html.replace(
  '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />',
  '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />'
);

// The root `html,body,#root { height: 100% }` rules from Expo's own reset
// can resolve shorter than the true screen in iOS Safari standalone mode
// with viewport-fit=cover -- percentages don't reliably reflect the full
// safe-area-inclusive viewport there. 100dvh (dynamic viewport height) is
// the unit made for this; browsers that don't support it just ignore the
// line and keep the 100% fallback above it.
if (!html.includes("100dvh")) {
  html = html.replace(
    "</style>",
    `  html, body, #root { height: 100dvh; height: var(--app-height, 100dvh); }\n    </style>`
  );
}

// 100dvh alone still left a blank strip below the tab bar when launched from
// the Home Screen: with the black-translucent status bar, iOS lays the page
// out from the very top of the screen but reports a viewport shorter by the
// status bar's height, so every height unit comes up that much short. In
// standalone mode the app owns the whole screen, so when the reported height
// is short of the screen's, size to the screen instead. If iOS reports the
// height correctly this sets nothing and the 100dvh fallback applies.
const fitScript = `<script>
(function () {
  var standalone = navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if (!standalone) return;
  function fit() {
    var portrait = window.innerHeight >= window.innerWidth;
    var full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    if (full > window.innerHeight) document.documentElement.style.setProperty("--app-height", full + "px");
    else document.documentElement.style.removeProperty("--app-height");
  }
  fit();
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
})();
</script>`;
if (!html.includes("--app-height\", full")) {
  html = html.replace("</head>", `  ${fitScript}\n</head>`);
}

// manifest.webmanifest (in public/) is what makes Chrome on Android and
// computers offer a real "Install" -- app.json's "web" keys don't produce
// one. sw.js lets the installed app open offline; once it's running, the
// files this first visit already loaded are handed to it to save.
const installTags = `<link rel="manifest" href="/manifest.webmanifest">
  <script>
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    var firstInstall = !navigator.serviceWorker.controller;
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(function () {
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      if (!firstInstall || !reg.active) return;
      var urls = performance.getEntriesByType("resource").map(function (e) { return e.name; });
      reg.active.postMessage({ type: "save-loaded-files", urls: urls });
    }).catch(function () {});
  });
}
  </script>`;
if (!html.includes('rel="manifest"')) {
  html = html.replace("</head>", `  ${installTags}\n</head>`);
}

fs.writeFileSync(indexPath, html);
console.log("Patched dist/index.html with iOS PWA meta tags.");
