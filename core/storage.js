/* core/storage.js — the localStorage data layer.
   HARD REQUIREMENT (redesign inventory §1/§3): every key, shape and cap is
   IDENTICAL to the current live app, so the recode reads existing users'
   device data exactly as the old code did. Do not rename keys or reshape
   values here — Stage 5 golden tests and real user devices depend on it. */

export const LS_HIST = "hcm_typing_history_v1";
export const LS_DONE = "hcm_drills_done_v1";
export const LS_BEST = "hcm_lesson_best10_v1";
export const LS_SET = "hcm_settings_v1";
export const LS_NAME = "hcm_profile_name_v1";
export const LS_REV = "hcm_revision_v1";
export const LS_THEME = "hcm_theme_v1";
export const GATE_KEY = "ts_gate_v1";
export const ACCTNAME_CACHE_PREFIX = "hcm_acctname_v1:";
export const NCRTC_BEST_KEY = "ncrtcBestV1";
export const LEGACY_PLACEHOLDER_NAME = "Ekta";

export function newClientId() {
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function parse(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch (e) { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

/* ---- history (newest first, capped at 200 — as loadHist/saveHist) ---- */
export function loadHist() {
  const h = parse(LS_HIST, []);
  if (!Array.isArray(h)) return [];
  h.forEach(function (x) {
    if (!x.clientId) x.clientId = newClientId();
    if (!x.ts) { const t = Date.parse(x.d); x.ts = isNaN(t) ? new Date().toISOString() : new Date(t).toISOString(); }
  });
  return h;
}
export function saveHist(h) { write(LS_HIST, (h || []).slice(0, 200)); }

/* ---- drills-done flags (98% Accuracy Gate) ---- */
export function loadDone() { const d = parse(LS_DONE, {}); return d && typeof d === "object" && !Array.isArray(d) ? d : {}; }
export function saveDone(d) { write(LS_DONE, d || {}); }

/* ---- per-item best entries (max 10 per item) ---- */
export function loadBest() { const b = parse(LS_BEST, {}); return b && typeof b === "object" && !Array.isArray(b) ? b : {}; }
export function saveBest(b) { write(LS_BEST, b || {}); }

export function entryTs(en) { const t = Date.parse((en && (en.ts || en.d)) || ""); return isNaN(t) ? 0 : t; }

export function sortBestArr(arr) {
  return (arr || []).map(function (en, i) { return { en: en, i: i }; }).sort(function (a, b) {
    const dt = entryTs(b.en) - entryTs(a.en);
    if (dt !== 0) return dt;
    return b.i - a.i;
  }).map(function (x) { return x.en; });
}

export function pushBest(id, entry) {
  if (!id || !entry) return [];
  const map = loadBest();
  let arr = Array.isArray(map[id]) ? map[id] : [];
  arr.push(entry);
  arr = sortBestArr(arr).slice(0, 10);
  map[id] = arr;
  saveBest(map);
  return arr;
}

/* lessonStatus — verbatim semantics from the current core.js:
   completed = any recorded attempt OR the done flag; passed = 98% gate flag;
   best = max-net entry (ties: higher acc, then latest). */
export function lessonStatus(id) {
  const bestMap = loadBest();
  const arr = Array.isArray(bestMap[id]) ? bestMap[id] : [];
  const doneMap = loadDone();
  const passed = !!doneMap[id];
  let best = null;
  arr.forEach(function (en) {
    if (!en) return;
    if (!best || (en.net || 0) > (best.net || 0) ||
      ((en.net || 0) === (best.net || 0) && ((en.acc || 0) > (best.acc || 0) ||
      ((en.acc || 0) === (best.acc || 0) && entryTs(en) >= entryTs(best))))) best = en;
  });
  return { attempts: arr.length, best: best, passed: passed, completed: arr.length > 0 || passed };
}

/* attempted-state for SSC hub mocks comes from HISTORY (inventory §3):
   first (newest) history entry carrying this testId. */
export function attemptedEntry(testId) {
  const h = loadHist();
  for (let i = 0; i < h.length; i++) { if (h[i].testId === testId) return h[i]; }
  return null;
}

/* ---- settings (hcm_settings_v1 — tolerate every key the old app wrote) ---- */
export function loadSettings() {
  const s = parse(LS_SET, {});
  return s && typeof s === "object" && !Array.isArray(s) ? s : {};
}
export const SETTINGS = loadSettings();
export function persistSettings() { write(LS_SET, SETTINGS); }
export function autoSubmitOn() { return SETTINGS.autoSubmit !== false; }

/* Name migration — verbatim from the current core.js: a stored placeholder
   name ("Ekta") is cleared; siteName folds into name; the legacy
   hcm_profile_name_v1 key is the last fallback. */
(function migrateName() {
  if (typeof SETTINGS.name === "string") {
    if (SETTINGS.name.trim() === LEGACY_PLACEHOLDER_NAME) { SETTINGS.name = ""; persistSettings(); }
    return;
  }
  let v = "";
  if (typeof SETTINGS.siteName === "string" && SETTINGS.siteName.trim() && SETTINGS.siteName.trim() !== LEGACY_PLACEHOLDER_NAME) v = SETTINGS.siteName.trim();
  else {
    try {
      const d = localStorage.getItem(LS_NAME);
      if (d && d.trim() && d.trim() !== LEGACY_PLACEHOLDER_NAME) v = d.trim();
    } catch (e) {}
  }
  SETTINGS.name = v;
  if ("siteName" in SETTINGS) delete SETTINGS.siteName;
  persistSettings();
})();

/* ---- per-account display-name cache ---- */
export function acctNameCacheGet(uid) {
  try { if (!uid) return ""; return (localStorage.getItem(ACCTNAME_CACHE_PREFIX + uid) || "").trim(); } catch (e) { return ""; }
}
export function acctNameCacheSet(uid, name) {
  try {
    if (!uid) return;
    const n = (name || "").trim();
    if (n) localStorage.setItem(ACCTNAME_CACHE_PREFIX + uid, n);
    else localStorage.removeItem(ACCTNAME_CACHE_PREFIX + uid);
  } catch (e) {}
}

/* ---- revision bank (Stage 3 owns the logic; the shape lives here) ---- */
export function revLoad() {
  const b = parse(LS_REV, null);
  if (b && Array.isArray(b.words)) return b;
  return { words: [], updatedAt: null };
}
export function revSave(bank) { write(LS_REV, bank); }

/* ---- NCRTC best scores (the ONLY NCRTC state — inventory §1) ---- */
export function loadNcrtcBests() { const b = parse(NCRTC_BEST_KEY, {}); return b && typeof b === "object" && !Array.isArray(b) ? b : {}; }
export function saveNcrtcBest(id, score, total) {
  const all = loadNcrtcBests();
  const prev = all[id];
  if (!prev || score > prev.score || (score === prev.score && total >= prev.total)) {
    all[id] = { score: score, total: total, ts: Date.now() };
    write(NCRTC_BEST_KEY, all);
  }
  return all[id];
}

/* ---- theme ---- */
export function savedTheme() {
  try { return localStorage.getItem(LS_THEME) === "dark" ? "dark" : localStorage.getItem(LS_THEME) === "light" ? "light" : null; }
  catch (e) { return null; }
}
export function persistTheme(t) { try { localStorage.setItem(LS_THEME, t); } catch (e) {} }

/* ---- clear-all (current behaviour: history + done + bests) ---- */
export function clearAllProgress() {
  try {
    localStorage.removeItem(LS_HIST);
    localStorage.removeItem(LS_DONE);
    localStorage.removeItem(LS_BEST);
  } catch (e) {}
}
