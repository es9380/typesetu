/* app.js — boot + hash router.
   - Hash routing (/#/...): page refreshes never 404 on GitHub Pages.
   - Lazy-mount: only the active route's feature module is imported and
     mounted; switching tabs destroys the previous mount (Stage 2's exam
     stage manages its own in-test guards inside its feature).
   - Firebase loads lazily AFTER first paint and fails soft: the app is
     fully usable as guest / offline. */

import { appState, applyTheme } from "./core/state.js";
import { SETTINGS, persistSettings, LS_NAME } from "./core/storage.js";
import { mountNavbar } from "./components/Navbar.js";
import { mountProfilePopover } from "./components/ProfilePopover.js";
import { openAuthModal } from "./components/AuthModal.js";

const ROUTES = {
  home: function () { return import("./features/home/home.js"); },
  arena: function () { return import("./features/examArena/arena.js"); },
  studio: function () { return import("./features/trainingStudio/studio.js"); },
  progress: function () { return import("./features/progress/progress.js"); },
  ncrtc: function () { return import("./features/ncrtcMcq/ncrtc.js"); },
  guide: function () { return import("./features/guide/guide.js"); }
};
/* Legacy hash aliases — the doorway pages and old bookmarks point at
   /#/hubs, /#/drills etc.; they must keep landing somewhere sensible. */
const ALIASES = {
  "": "home", home: "home", hubs: "arena", hub: "arena",
  drills: "studio", warmup: "studio", practice: "studio", test: "studio",
  customtests: "arena", revision: "progress", progress: "progress",
  arena: "arena", studio: "studio", ncrtc: "ncrtc", guide: "guide"
};

function parseHash() {
  const raw = (location.hash || "#/").replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  const first = parts[0] || "";
  if (first === "login" || first === "signup") return { route: "home", param: null, auth: first };
  let route = ALIASES[first] || "home";
  let param = null;
  if (route === "arena") {
    if (first === "hub" && parts[1]) param = parts[1];
    else if (parts[1] === "hub" && parts[2]) param = parts[2];
    else if (parts[1]) param = parts[1];
  }
  if (!ROUTES[route]) route = "home";
  return { route: route, param: param, auth: null };
}

const SKELETON = '<div aria-hidden="true"><div class="skel skel-hero"></div><div class="skel skel-line" style="width:70%"></div><div class="skel skel-line" style="width:55%"></div><div class="skel skel-box"></div><div class="skel-row"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>';
const appEl = document.getElementById("app");
let current = null;   // { route, destroy }
let navToken = 0;

async function render() {
  const { route, param, auth } = parseHash();
  const token = ++navToken;
  if (current && current.destroy) { try { current.destroy(); } catch (e) {} }
  current = null;
  appEl.classList.remove("view-enter");
  /* skeleton while the route module downloads (cleared before mount) */
  appEl.innerHTML = SKELETON;
  try {
    const mod = await ROUTES[route]();
    if (token !== navToken) return;               // a newer navigation won
    appEl.innerHTML = "";
    const mount = mod.mount || mod.default;
    const inst = mount(appEl, { param: param, route: route });
    current = { route: route, destroy: inst && inst.destroy };
    void appEl.offsetWidth;                        // restart the enter animation
    appEl.classList.add("view-enter");
    window.scrollTo(0, 0);
  } catch (e) {
    console.error("Route failed:", route, e);
    appEl.innerHTML = '<div class="card"><h2>That page could not load</h2><p class="muted">Please check your connection and try again.</p></div>';
  }
  if (auth) openAuthModal(auth === "signup" ? "signup" : "login");
}

/* ---- boot ---- */
applyTheme(appState.theme, false);

/* Standing rule, mirrored from the current app: a name exists only when
   signed in. A guest's stored settings name is cleared at boot (the cloud
   account name + per-account cache restore it on sign-in). */
if ((SETTINGS.name || "").trim()) {
  SETTINGS.name = "";
  persistSettings();
  try { localStorage.removeItem(LS_NAME); } catch (e) {}
}

mountNavbar(document.getElementById("siteHeader"));
mountProfilePopover(document.getElementById("accountSlot"));

window.addEventListener("hashchange", render);
render();

/* Firebase — lazy, after first paint, fail-soft. */
setTimeout(function () {
  import("./services/firebaseService.js")
    .then(function (m) {
      m.initFirebaseService();
      /* Stage 3: register the login-time revision-bank MERGE hook that
         Stage 1 deliberately left open — the local and cloud banks are
         merged (never overwritten) whenever the service signs in. */
      import("./features/progress/revision.js")
        .then(function (r) { r.registerRevisionSyncHook(); })
        .catch(function () {});
    })
    .catch(function (e) { console.warn("Firebase unavailable — continuing as guest/offline", e); });
}, 60);
