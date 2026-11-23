/* core/stats.js — pure read-outs over the EXISTING history/done data.
   The formulas are the current dashboard/trends computations, moved — not
   changed (inventory §3, Stage 0 goldens pin the engines, these pin the
   read-outs): dashboard best = max net over history; streak = consecutive
   days with ≥1 history entry, counting back from today. */

import { loadHist, loadDone } from "./storage.js";
import { specOf } from "../data/examSpecs.js";

/* Mirrors renderDashboard(): tests taken, best net, average accuracy,
   gate-passed count over total typeable texts. */
export function dashboardStats(totalTexts) {
  const h = loadHist();
  const done = loadDone();
  return {
    tests: h.length,
    bestNet: h.length ? Math.max.apply(null, h.map(function (x) { return x.net; })) : null,
    avgAcc: h.length ? (h.reduce(function (a, x) { return a + x.acc; }, 0) / h.length) : null,
    drillsPassed: Object.keys(done).length,
    totalTexts: totalTexts
  };
}

/* Mirrors the streak loop in renderTrends(): days are keyed by
   Date#toDateString() of each entry's ts (falling back to its date string). */
export function currentStreak(now = new Date()) {
  const all = loadHist();
  const daysSet = {};
  all.forEach(function (x) {
    const d = new Date(x.ts || x.d);
    if (!isNaN(d)) daysSet[d.toDateString()] = 1;
  });
  let streak = 0;
  const cur = new Date(now);
  while (daysSet[cur.toDateString()]) { streak++; cur.setDate(cur.getDate() - 1); }
  return streak;
}

/* Trends headline numbers (Stage 3 renders the full Progress view from these). */
export function trendsSummary() {
  const all = loadHist();
  if (!all.length) return null;
  const total = all.length;
  const mins = all.reduce(function (a, x) { return a + (x.durSec ? x.durSec / 60 : (x.min || 0)); }, 0);
  const last10 = all.slice(-10);
  const weekCut = Date.now() - 7 * 86400000;
  return {
    total: total,
    totalMinutes: mins,
    bestNet: Math.max.apply(null, all.map(function (x) { return x.net; })),
    avgNet: all.reduce(function (a, x) { return a + x.net; }, 0) / total,
    avgNetLast10: last10.reduce(function (a, x) { return a + x.net; }, 0) / last10.length,
    avgAcc: all.reduce(function (a, x) { return a + x.acc; }, 0) / total,
    thisWeek: all.filter(function (x) { return new Date(x.ts || x.d).getTime() >= weekCut; }).length,
    streak: currentStreak()
  };
}

/* ---------- v13 additions (read-only over existing history) ---------- */

function sameDay(a, b) { return a.toDateString() === b.toDateString(); }

/* Tests completed today (any mode). */
export function testsToday(now = new Date()) {
  return loadHist().filter(function (x) {
    const d = new Date(x.ts || x.d); return !isNaN(d) && sameDay(d, now);
  }).length;
}

/* Total typing time per day (v16, read-only): sums EVERY history entry's
   duration — durSec (actual elapsed seconds) when present, else min×60,
   the same fallback trendsSummary() uses — keyed by the entry's local
   calendar day. Covers mocks, custom tests, drills, warm-ups, practice
   passages and revision alike, since all of them land in this history.
   Returns the last `days` days, oldest first, today last:
   [{ date: Date (local midnight), seconds }]. */
export function typingTimeByDay(days = 7, now = new Date()) {
  const per = {};
  loadHist().forEach(function (x) {
    const d = new Date(x.ts || x.d);
    if (isNaN(d)) return;
    const sec = x.durSec ? +x.durSec : (x.min ? +x.min * 60 : 0);
    if (!sec || isNaN(sec)) return;
    const k = d.toDateString();
    per[k] = (per[k] || 0) + sec;
  });
  const out = [];
  const cur = new Date(now); cur.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(cur); d.setDate(d.getDate() - i);
    out.push({ date: d, seconds: per[d.toDateString()] || 0 });
  }
  return out;
}

/* Daily goal lives under its OWN new key — it never touches existing data. */
const LS_GOAL = "ts_daily_goal_v1";
export function getDailyGoal() {
  try { const n = parseInt(localStorage.getItem(LS_GOAL), 10); return n >= 1 && n <= 10 ? n : 2; } catch (e) { return 2; }
}
export function setDailyGoal(n) { try { localStorage.setItem(LS_GOAL, String(n)); } catch (e) {} }

/* Readiness estimate for one exam: average of the last 5 attempts of that
   exam vs its target WPM, discounted when accuracy is under 95%.
   Returns null until the person has at least one attempt for that exam. */
export function readiness(examId, targetWPM) {
  /* HCM-stage entries predate the examId field: locally they carry
     none, and after a Firestore round-trip they carry examId: ""
     (firebaseService re-maps with `x.examId || ""`). Both shapes are
     HCM attempts — falsy or "hcm" counts. Every other exam matches
     strictly: their entries always carry a real id, so "" can never
     leak into them. */
  const mine = loadHist().filter(function (x) {
    const examMatch = examId === "hcm" ? (!x.examId || x.examId === "hcm") : (x.examId === examId);
    return examMatch && typeof x.net === "number";
  }).slice(0, 5);
  if (!mine.length) return null;
  const avgNet = mine.reduce(function (a, x) { return a + x.net; }, 0) / mine.length;
  const avgAcc = mine.reduce(function (a, x) { return a + (x.acc || 0); }, 0) / mine.length;
  const accF = Math.min(1, Math.max(0, avgAcc / 95));
  if (!targetWPM) {
    /* Zero-target exams (CGL DEST: targetWPM is literally 0 — there is
       no speed bar; the standard is finishing inside the error cap).
       Readiness must still exist once attempts do, so derive it from
       the attempts themselves: accuracy against the same 95% benchmark
       used above, times the headroom the average error% leaves under
       the exam's UR error cap (from its spec categories; CGL UR = 20%).
       Attempts carrying no error% fall back to accuracy alone. */
    const withErr = mine.filter(function (x) { return typeof x.errorPct === "number"; });
    let pct;
    if (withErr.length) {
      const sp = specOf(examId);
      const ur = sp && sp.categories ? sp.categories.find(function (c) { return c.id === "UR"; }) : null;
      const cap = ur && ur.cap > 0 ? ur.cap : 20;
      const avgErr = withErr.reduce(function (a, x) { return a + x.errorPct; }, 0) / withErr.length;
      const errF = Math.min(1, Math.max(0, 1 - avgErr / cap));
      pct = Math.round(accF * errF * 100);
    } else {
      pct = Math.round(accF * 100);
    }
    return { pct: pct, avgNet: Math.round(avgNet * 10) / 10, avgAcc: Math.round(avgAcc * 10) / 10, n: mine.length };
  }
  const speed = Math.min(1, Math.max(0, avgNet / targetWPM));
  return { pct: Math.round(speed * accF * 100), avgNet: Math.round(avgNet * 10) / 10, avgAcc: Math.round(avgAcc * 10) / 10, n: mine.length };
}

/* Most frequent weak keys across the last 20 results. */
export function topWeakKeys(limit = 3) {
  const tally = {};
  loadHist().slice(0, 20).forEach(function (x) {
    if (x.weakKeys) Object.keys(x.weakKeys).forEach(function (k) { tally[k] = (tally[k] || 0) + x.weakKeys[k]; });
  });
  return Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; }).slice(0, limit);
}
