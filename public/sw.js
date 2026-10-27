// Lets the installed app open with no internet. All the user's data already
// lives on the device (SQLite in the browser), so only the app's own files
// need saving:
// - The page (index.html) is network-first: online, every open gets the
//   latest deploy; offline, the last saved copy is used.
// - Built files (/_expo/, /assets/) have the content hash in their name, so
//   they never change and are served from the cache once saved.
// Each deploy's built files go in their own cache, named after a hash of its
// index.html; when a new deploy's page arrives, older ones are deleted.
// /api/ (statement reading, Google sign-in) and other sites are never touched.
const SHELL_CACHE = "fia-shell";
const ASSETS_PREFIX = "fia-assets-";
const PAGE_KEY = "/index.html";
const VERSION_KEY = "/__fia-version";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function currentAssetsCache() {
  const shell = await caches.open(SHELL_CACHE);
  const saved = await shell.match(VERSION_KEY);
  return ASSETS_PREFIX + (saved ? await saved.text() : "first");
}

async function savePage(response) {
  const version = hashText(await response.clone().text());
  const shell = await caches.open(SHELL_CACHE);
  await shell.put(PAGE_KEY, response.clone());
  await shell.put(VERSION_KEY, new Response(version));
  const keep = ASSETS_PREFIX + version;
  for (const name of await caches.keys()) {
    if (name.startsWith(ASSETS_PREFIX) && name !== keep) await caches.delete(name);
  }
}

async function openPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await savePage(response);
    return response;
  } catch (err) {
    const saved = await caches.match(PAGE_KEY, { cacheName: SHELL_CACHE });
    if (saved) return saved;
    throw err;
  }
}

async function builtFile(request) {
  const cache = await caches.open(await currentAssetsCache());
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") await cache.put(request, response.clone());
  return response;
}

// Small files that aren't hashed (icons, manifest): fresh when online, the
// saved copy when offline.
async function otherFile(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const shell = await caches.open(SHELL_CACHE);
      await shell.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const saved = await caches.match(request, { cacheName: SHELL_CACHE });
    if (saved) return saved;
    throw err;
  }
}

// On the very first visit the page loads before this worker is running, so
// nothing got saved; the page then sends the files it already loaded.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "save-loaded-files") return;
  event.waitUntil(
    (async () => {
      const page = await fetch("/");
      if (page.ok) await savePage(page);
      for (const href of event.data.urls) {
        const url = new URL(href);
        if (url.origin !== self.location.origin) continue;
        if (url.pathname.startsWith("/_expo/") || url.pathname.startsWith("/assets/")) {
          await builtFile(new Request(href)).catch(() => {});
        }
      }
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    // auth-callback.html is the Google sign-in return page, not the app.
    if (url.pathname.endsWith(".html") && url.pathname !== "/index.html") return;
    event.respondWith(openPage(request));
  } else if (url.pathname.startsWith("/_expo/") || url.pathname.startsWith("/assets/")) {
    event.respondWith(builtFile(request));
  } else {
    event.respondWith(otherFile(request));
  }
});
