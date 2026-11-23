/* core/state.js — tiny shared app state + pub/sub.
   Holds ONLY shell-level state (active exam, theme, auth snapshot).
   Feature state lives inside its feature module (isolation rule). */

import { savedTheme, persistTheme } from "./storage.js";

const listeners = new Map();

export const appState = {
  activeExam: "hcm",                       // shared by header switcher + Home slab bar
  theme: savedTheme() || "dark",           // saved theme wins; new users default DARK (prompt §1)
  user: null,                              // Firebase user snapshot (null = signed out / guest)
  accountName: "",                         // display name when signed in (never shown signed-out)
  cloudReady: false                        // firebaseService finished init (true even in offline fallback)
};

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return function () { listeners.get(evt).delete(fn); };
}
export function emit(evt, payload) {
  const set = listeners.get(evt);
  if (set) set.forEach(function (fn) { try { fn(payload); } catch (e) { console.warn("state listener", e); } });
}

export function setActiveExam(id) {
  if (appState.activeExam === id) return;
  appState.activeExam = id;
  emit("exam", id);
}

export function applyTheme(t) {
  appState.theme = t;
  document.documentElement.setAttribute("data-theme", t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#0F1117" : "#F8FAFC");
}
export function setTheme(t, save = true) {
  applyTheme(t);
  if (save) persistTheme(t);
  emit("theme", t);
}

export function setUser(user, accountName) {
  appState.user = user || null;
  appState.accountName = accountName || "";
  emit("auth", appState.user);
}
