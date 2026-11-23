/* core/rateLimit.js — client-side rate limiting, ported verbatim (semantics)
   from the current rate-limit.js. Same localStorage prefix (ts_rl_v1:) and
   buckets: login 5/5min, signup 5/1h (note: inventory summarised 3/hr from an
   older comment; the live RATE_LIMITS below are what the code enforces),
   passwordReset 3/15min, cloudWrite 60/10min. Not a security boundary —
   Firestore rules + Firebase Auth throttling enforce server-side. */

const PREFIX = "ts_rl_v1:";
const memory = {};
const timers = {};

function read(key) {
  if (memory[key]) return memory[key];
  try { const v = JSON.parse(localStorage.getItem(PREFIX + key) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function write(key, arr) {
  memory[key] = arr;
  try { localStorage.setItem(PREFIX + key, JSON.stringify(arr)); } catch (e) {}
}

export const RateLimit = {
  /* Sliding window: {ok:true} or {ok:false, retryIn:<seconds>} */
  attempt(key, limit, windowMs) {
    const now = Date.now();
    const arr = read(key).filter(function (t) { return now - t < windowMs; });
    if (arr.length >= limit) {
      write(key, arr);
      return { ok: false, retryIn: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) };
    }
    arr.push(now);
    write(key, arr);
    return { ok: true, retryIn: 0 };
  },
  reset(key) {
    delete memory[key];
    try { localStorage.removeItem(PREFIX + key); } catch (e) {}
  },
  /* Trailing debounce keyed by name: only the last call in a burst runs. */
  debounce(key, waitMs, fn) {
    if (timers[key]) clearTimeout(timers[key]);
    timers[key] = setTimeout(function () { delete timers[key]; fn(); }, waitMs);
  },
  waitText(sec) {
    if (sec >= 60) { const m = Math.ceil(sec / 60); return m + " minute" + (m === 1 ? "" : "s"); }
    return sec + " second" + (sec === 1 ? "" : "s");
  }
};

export const RATE_LIMITS = {
  login: { limit: 5, windowMs: 5 * 60 * 1000 },
  signup: { limit: 5, windowMs: 60 * 60 * 1000 },
  passwordReset: { limit: 3, windowMs: 15 * 60 * 1000 },
  cloudWrite: { limit: 60, windowMs: 10 * 60 * 1000 }
};

/* Returns null when allowed, or the "too many attempts" message (as the
   current rateLimited() does — truthy string blocks the action). */
export function rateLimited(name) {
  const cfg = RATE_LIMITS[name];
  const r = RateLimit.attempt(name, cfg.limit, cfg.windowMs);
  return r.ok ? null : "Too many attempts. Please wait " + RateLimit.waitText(r.retryIn) + " and try again.";
}
