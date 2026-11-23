/* core/stats.js — pure read-outs over the EXISTING history/done data.
   The formulas are the current dashboard/trends computations, moved — not
   changed (inventory §3, Stage 0 goldens pin the engines, these pin the
   read-outs): dashboard best = max net over history; streak = consecutive
   days with ≥1 history entry, counting back from today. */

import { loadHist, loadDone } from "./storage.js";

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
