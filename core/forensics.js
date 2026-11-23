/* core/forensics.js — result forensics ("Your Typing, Explained") and the
   revision bank (weak-word recording at finish).
   VERBATIM ports from the current forensics-revision.js: the fx* section
   builders, forensicsHtml, wordErrorType, revFeed's bank update policy
   (stage reset on any new scored error, 1→3→7→16-day ladder lives in
   revApplyResult — Stage 3's sessions), the 500-learning-word guard, and
   the merge helpers. Plumbing changes only: revLoad/revSave come from
   core/storage.js, the debounced cloud write goes through
   firebaseService.writeRevisionCloud, and paintRevBadges becomes an
   appState "revision" event (Progress renders badges in Stage 3). */

import { revLoad, revSave as revSaveLocal } from "./storage.js";
import { lev } from "./scoringMatrix.js";
import { appState, emit } from "./state.js";
import { escapeHtml } from "../components/ProfilePopover.js";
import { writeRevisionCloud } from "../services/firebaseService.js";

export { revLoad };

/* ---------------- forensics sections (verbatim) ---------------- */
function fxTpc(w) { const len = Math.max(1, (w.exp || w.got || "").length); return (w.endMs - w.startMs) / len; }
function hcmBandInfo(n) {
  if (n < 30) return { label: "below 30", marks: 0, nextAt: 30, nextMarks: 10 };
  if (n < 31) return { label: "30", marks: 10, nextAt: 31, nextMarks: 12 };
  if (n <= 35) return { label: "31–35", marks: 12, nextAt: 36, nextMarks: 15 };
  if (n <= 40) return { label: "36–40", marks: 15, nextAt: 41, nextMarks: 18 };
  if (n <= 45) return { label: "41–45", marks: 18, nextAt: 46, nextMarks: 21 };
  if (n <= 50) return { label: "46–50", marks: 21, nextAt: 51, nextMarks: 25 };
  return null;
}
function fxDistance(ctx) {
  if (ctx.engine === "E3") {
    const n = ctx.netWpm, b = hcmBandInfo(n);
    if (!b) return "Your net speed <strong>" + n.toFixed(1) + " WPM</strong> is in the top band — full <strong>25 marks</strong>. The job now is making it repeatable.";
    if (n < 30) return "Your net speed <strong>" + n.toFixed(1) + " WPM</strong> is below the 30 WPM qualifying minimum — <strong>30 WPM</strong> is the first step, into the 10-mark band.";
    return "Your net speed <strong>" + n.toFixed(1) + " WPM</strong> sits in the " + b.label + " band (" + b.marks + " marks). <strong>" + b.nextAt + " WPM</strong> would put you in the " + b.nextMarks + "-mark band.";
  }
  if (ctx.engine === "E1") {
    const ep = Math.min(100, Math.max(0, ctx.errorPct || 0)), cap = ctx.cap; let s;
    if (ep <= cap) s = "Error <strong>" + ep.toFixed(1) + "%</strong> — inside the " + cap + "% " + escapeHtml(ctx.catLabel || "") + " cap, with <strong>" + (cap - ep).toFixed(1) + " points</strong> to spare.";
    else s = "Error <strong>" + ep.toFixed(1) + "%</strong> — over the " + cap + "% " + escapeHtml(ctx.catLabel || "") + " cap by <strong>" + (ep - cap).toFixed(1) + " points</strong>. That gap is the thing to close.";
    if (ctx.examId === "chsl") {
      if (ctx.netWpm >= 35) s += " Net speed <strong>" + Math.round(ctx.netWpm) + " WPM</strong> also clears the 35 WPM target.";
      else s += " Net speed <strong>" + Math.round(ctx.netWpm) + " WPM</strong> is about " + Math.ceil(35 - ctx.netWpm) + " short of the 35 WPM target.";
    }
    return s;
  }
  const parts = [];
  if (ctx.netWpm >= 30) parts.push("Net speed <strong>" + ctx.netWpm.toFixed(1) + " WPM</strong> — " + (ctx.netWpm - 30).toFixed(1) + " above the 30 WPM qualifying floor.");
  else parts.push("Net speed <strong>" + ctx.netWpm.toFixed(1) + " WPM</strong> — " + (30 - ctx.netWpm).toFixed(1) + " below the 30 WPM qualifying floor.");
  if (ctx.wordsTyped < 300) parts.push("Words typed <strong>" + ctx.wordsTyped + "</strong> — short of the prescribed ~300-word passage, so mistakes had less room to average out.");
  else parts.push("Words typed <strong>" + ctx.wordsTyped + "</strong> — the full prescribed passage length.");
  return parts.join(" ");
}
function fxThirdSpeed(slice, tel, startIdx) {
  let chars = 0, mins = 0;
  slice.forEach(function (bk, k) {
    const idx = startIdx + k; chars += bk.chars;
    let durMs = Math.min(tel.bucketSec * 1000, tel.activeMs - idx * tel.bucketSec * 1000); if (durMs <= 0) durMs = tel.bucketSec * 1000;
    mins += durMs / 60000;
  });
  return mins > 0 ? (chars / 5) / mins : 0;
}
function fxInsights(tel, ctx, words, mistakes, aggOnly) {
  const out = [], full = !aggOnly && words.length >= 40;
  if (full && tel.buckets && tel.buckets.length >= 3 && ctx.completion != null && ctx.completion >= 60) {
    const b = tel.buckets, third = Math.floor(b.length / 3);
    if (third >= 1) {
      const fsp = fxThirdSpeed(b.slice(0, third), tel, 0), lsp = fxThirdSpeed(b.slice(b.length - third), tel, b.length - third);
      if (fsp > 0 && lsp > 0) {
        const d = (lsp - fsp) / fsp * 100;
        if (d <= -10) out.push("You slowed down towards the end — <strong>" + Math.round(fsp) + " WPM</strong> in the first third, <strong>" + Math.round(lsp) + " WPM</strong> in the last.");
        else if (d >= 10) out.push("You sped up as you went — <strong>" + Math.round(fsp) + " WPM</strong> in the first third, <strong>" + Math.round(lsp) + " WPM</strong> in the last. A steadier start usually scores better.");
      }
    }
  }
  if (tel.activeMs > 0 && tel.fixingMs / tel.activeMs >= 0.05) {
    const weq = Math.round(tel.fixingMs * ((ctx.chars || 0) / tel.activeMs) / 5);
    out.push("Fixing mistakes cost you about <strong>" + Math.round(tel.fixingMs / 1000) + " seconds</strong> — " + Math.round(tel.fixingMs / tel.activeMs * 100) + "% of your test. At your average speed that's roughly <strong>" + weq + " words</strong> you could have typed instead.");
  }
  if (full && tel.pauseCount >= 3) {
    let txt = "You paused <strong>" + tel.pauseCount + " times</strong> for over 2 seconds — " + Math.round(tel.pauseMs / 1000) + " seconds in total. The longest was <strong>" + Math.round(tel.longestPauseMs / 1000) + " seconds</strong>";
    const lw = words[tel.longestPauseWord];
    if (lw) txt += ", around word " + (tel.longestPauseWord + 1) + " ('" + escapeHtml(lw.exp || lw.got) + "')";
    out.push(txt + ".");
  }
  if (full && mistakes.length >= 4) {
    const sorted = words.slice().sort(function (a, b) { return fxTpc(a) - fxTpc(b); });
    const thirdN = Math.floor(sorted.length / 3);
    if (thirdN >= 5) {
      const fast = sorted.slice(0, thirdN), slow = sorted.slice(sorted.length - thirdN);
      let fm = 0, sm = 0;
      fast.forEach(function (w) { if (w.st !== "ok") fm++; });
      slow.forEach(function (w) { if (w.st !== "ok") sm++; });
      const fr = fm / fast.length, sr = sm / slow.length;
      if (fm > sm && (sr === 0 ? fm >= 2 : fr >= 2 * sr)) out.push("Most of your mistakes (<strong>" + fm + " of " + mistakes.length + "</strong>) happened in words you typed faster than your usual pace. Easing off slightly on those words protects your score.");
    }
  }
  if (full && tel.correctedSlips >= 5 && ctx.acc >= 98) {
    out.push("You caught and fixed <strong>" + tel.correctedSlips + " slips</strong> yourself — they cost time but zero marks.");
  }
  const dist = fxDistance(ctx); if (dist) out.push(dist);
  return out;
}
function fxChart(tel, ctx) {
  const b = tel.buckets, nb = b.length;
  const totalChars = b.reduce(function (a, x) { return a + x.chars; }, 0);
  const overall = totalChars / 5 / (tel.activeMs / 60000);
  let maxW = 1; b.forEach(function (x) { if (x.wpm > maxW) maxW = x.wpm; }); if (overall > maxW) maxW = overall;
  maxW = Math.max(10, Math.ceil(maxW * 1.15));
  const W = 660, H = 212, pl = 36, pr = 8, pt = 16, pb = 26, pw = W - pl - pr, ph = H - pt - pb, bw = pw / nb;
  let s = "<div class='fxSec'><h3>Speed through the test</h3><svg viewBox='0 0 " + W + " " + H + "' style='width:100%;height:auto;display:block' role='img' aria-label='Your speed in each " + tel.bucketSec + "-second stretch of the test'>";
  [0, 0.5, 1].forEach(function (f) { const y = pt + ph - ph * f;
    s += "<line x1='" + pl + "' y1='" + y + "' x2='" + (W - pr) + "' y2='" + y + "' stroke='var(--border)' stroke-width='1'/><text x='" + (pl - 6) + "' y='" + (y + 4) + "' font-size='11' fill='var(--muted)' text-anchor='end'>" + Math.round(maxW * f) + "</text>";
  });
  b.forEach(function (x, i) {
    const bh = (x.wpm / maxW) * ph, x0 = pl + i * bw + 2, w0 = Math.max(2, bw - 4), y0 = pt + ph - bh;
    s += "<rect x='" + x0.toFixed(1) + "' y='" + y0.toFixed(1) + "' width='" + w0.toFixed(1) + "' height='" + Math.max(0, bh).toFixed(1) + "' rx='3' fill='var(--accent)' opacity='0.85'/>";
    if (nb <= 20) s += "<text x='" + (x0 + w0 / 2).toFixed(1) + "' y='" + (y0 - 4) + "' font-size='10.5' fill='var(--text)' text-anchor='middle'>" + Math.round(x.wpm) + "</text>";
    if (nb <= 10 || i % 2 === 0) { const tsec = i * tel.bucketSec; s += "<text x='" + (x0 + w0 / 2).toFixed(1) + "' y='" + (H - 8) + "' font-size='10.5' fill='var(--muted)' text-anchor='middle'>" + Math.floor(tsec / 60) + ":" + ("0" + (tsec % 60)).slice(-2) + "</text>"; }
  });
  const oy = pt + ph - (overall / maxW) * ph;
  s += "<line x1='" + pl + "' y1='" + oy + "' x2='" + (W - pr) + "' y2='" + oy + "' stroke='var(--target)' stroke-width='2' stroke-dasharray='6 4'/><text x='" + (W - pr) + "' y='" + (oy - 6) + "' font-size='11' font-weight='700' fill='var(--target)' text-anchor='end'>Overall " + overall.toFixed(1) + " WPM</text>";
  s += "</svg><p class='small' style='margin:0'>Bars: WPM in each " + tel.bucketSec + "-second stretch, counted only from characters still on screen at the end. Dashed line: your overall gross speed.</p></div>";
  return s;
}
function fxWhen(tel, mistakes) {
  const counts = [0, 0, 0];
  mistakes.forEach(function (w) { let idx = tel.activeMs > 0 ? Math.floor(w.endMs / tel.activeMs * 3) : 0; if (idx > 2) idx = 2; if (idx < 0) idx = 0; counts[idx]++; });
  const mx = Math.max(counts[0], counts[1], counts[2], 1), names = ["First third", "Middle third", "Last third"];
  let h = "<div class='fxSec'><h3>When mistakes happened</h3>";
  counts.forEach(function (c, i) { h += "<div class='fxBarRow'><span class='fxBarLab'>" + names[i] + "</span><span class='fxBarTrack'><i style='width:" + Math.round(c / mx * 100) + "%'></i></span><strong>" + c + "</strong></div>"; });
  return h + "</div>";
}
function fxSlowWords(words) {
  const tpcs = words.map(fxTpc).sort(function (a, b) { return a - b; });
  const med = tpcs[Math.floor(tpcs.length / 2)] || 0; if (med <= 0) return "";
  const flagged = words.filter(function (w) { return fxTpc(w) >= 1.5 * med || w.paused; });
  if (!flagged.length) return "";
  flagged.sort(function (a, b) { return (b.endMs - b.startMs) - (a.endMs - a.startMs); });
  let h = "<div class='fxSec'><h3>Words that slowed you down</h3><p class='small'>Words that took far longer than your typical pace for their length. A pause is not slow typing — words where you stopped are marked as pauses, never merged into slowness.</p>";
  flagged.slice(0, 8).forEach(function (w) {
    const dur = (w.endMs - w.startMs) / 1000, typ = med * Math.max(1, (w.exp || "").length) / 1000;
    h += "<div class='fxWordRow'><span class='mono'><strong>" + escapeHtml(w.exp || w.got) + "</strong></span><span>" + dur.toFixed(1) + "s <span class='small'>(your typical for this length: " + typ.toFixed(1) + "s)</span></span><span class='fxTag'>" + (w.paused ? "paused here" : "slow") + "</span></div>";
  });
  return h + "</div>";
}
function fxKeys(tel) {
  const pairs = (tel.confusions || []).filter(function (c) { return c.n >= 2; }).slice(0, 6), lines = [];
  pairs.forEach(function (c) { lines.push("You typed <strong class='mono'>" + escapeHtml(c.got) + "</strong> for <strong class='mono'>" + escapeHtml(c.exp) + "</strong> — " + c.n + " times"); });
  if (tel.omissions >= 3) lines.push("You dropped a letter <strong>" + tel.omissions + " times</strong> (omissions).");
  if (tel.insertions >= 3) lines.push("You added an extra letter <strong>" + tel.insertions + " times</strong> (insertions).");
  if (!lines.length) return "";
  return "<div class='fxSec'><h3>Keys you mix up</h3>" + lines.map(function (l) { return "<p style='margin:0 0 6px'>" + l + "</p>"; }).join("") + "<p class='small' style='margin:0'>Counted from your final text only — a slip you corrected is not a mix-up.</p></div>";
}
function fxFixing(tel, ctx) {
  let h = "<div class='fxSec'><h3>Fixing mistakes</h3>";
  if (!tel.backspaces) return h + "<p style='margin:0'>No corrections — every word was typed once.</p></div>";
  const pct = tel.activeMs ? tel.fixingMs / tel.activeMs * 100 : 0;
  const weq = tel.activeMs ? Math.round(tel.fixingMs * ((ctx.chars || 0) / tel.activeMs) / 5) : 0;
  h += "<div class='statsGrid' style='margin:4px 0 8px'>"
    + "<div class='stat'><div class='v'>" + tel.backspaces + "</div><div class='l'>Backspaces</div></div>"
    + "<div class='stat'><div class='v'>" + tel.bursts + "</div><div class='l'>Fix bursts</div></div>"
    + "<div class='stat'><div class='v'>" + (tel.fixingMs / 1000).toFixed(1) + "s</div><div class='l'>Time fixing</div></div>"
    + "<div class='stat'><div class='v'>" + pct.toFixed(1) + "%</div><div class='l'>Share of test</div></div></div>"
    + "<p style='margin:0'>That fixing time equals roughly <strong>" + weq + " words</strong> at your average speed.</p></div>";
  return h;
}
function fxTech(tel, ctx) {
  const totalChars = tel.buckets ? tel.buckets.reduce(function (a, x) { return a + x.chars; }, 0) : (ctx.chars || 0);
  const overall = tel.activeMs ? totalChars / 5 / (tel.activeMs / 60000) : 0;
  let h = "<details class='fxTech'><summary>Technical details</summary><ul class='tight'>"
    + "<li>Deep analysis v" + tel.v + " — recorded from this attempt's own keystrokes, first keystroke to finish. Nothing is estimated, and nothing is carried over from other attempts.</li>"
    + "<li>Active time " + (tel.activeMs / 1000).toFixed(1) + "s · Pauses over 2s: " + tel.pauseCount + ", totalling " + (tel.pauseMs / 1000).toFixed(1) + "s (longest " + (tel.longestPauseMs / 1000).toFixed(1) + "s). Pauses are reported, never subtracted from your time.</li>";
  if (ctx.engine !== "E2") h += "<li>Fixing time is measured per fix burst — from a burst's first Backspace to the keystroke that restores the word, or the word's end — and capped at 5 seconds per burst, so thinking time after a fix is never billed as fixing.</li>";
  if (tel.buckets) h += "<li>Bucket speed = final-text characters typed in that " + tel.bucketSec + "s ÷ 5 ÷ " + (tel.bucketSec / 60) + " min. Deleted characters never count.</li>"
    + "<li>Reconciliation check: duration-weighted mean of bucket speeds vs overall gross speed (" + overall.toFixed(1) + " WPM) — " + (tel.reconOk ? "passed ✓ (within ±1 WPM)" : "failed, so the speed chart is hidden rather than shown wrong") + ".</li>";
  return h + "</ul></details>";
}
export function forensicsHtml(tel, ctx) {
  if (!tel || tel.v !== 1) return "";
  let h = "";
  if (ctx.engine === "E2") h += "<p class='small' style='margin-top:12px'>The learning sections below use your word-by-word results <strong>before the 5% allowance</strong>; the headline figures above are after it.</p>";
  const aggOnly = !tel.words, words = tel.words || [];
  const mistakes = words.filter(function (w) { return w.st === "full" || w.st === "half"; });
  const ins = fxInsights(tel, ctx, words, mistakes, aggOnly);
  if (ins.length) h += "<div class='fxSec'><h3>Your Typing, Explained</h3>" + ins.map(function (t, i) { return "<div class='fxInsight'><span class='fxN'>" + (i + 1) + "</span><p>" + t + "</p></div>"; }).join("") + "</div>";
  if (tel.buckets && tel.buckets.length >= 4 && tel.reconOk) h += fxChart(tel, ctx);
  if (!aggOnly && mistakes.length >= 1) h += fxWhen(tel, mistakes);
  if (!aggOnly && words.length >= 10) { const sw = fxSlowWords(words); if (sw) h += sw; }
  if (!aggOnly && words.length >= 40) { const kk = fxKeys(tel); if (kk) h += kk; }
  if (ctx.engine !== "E2") h += fxFixing(tel, ctx);
  h += fxTech(tel, ctx);
  return h;
}

/* ---------------- revision bank (verbatim policy) ---------------- */
export function revDateStr(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
export function revToday() { return revDateStr(new Date()); }
export function revAddDays(dateStr, n) { const d = new Date(dateStr + "T12:00:00"); d.setDate(d.getDate() + n); return revDateStr(d); }

let revCloudTimer = null;
export function revSave(bank) {
  revSaveLocal(bank);
  emit("revision", bank);
  /* Old behaviour: debounced (4s) cloud write of the latest bank when
     signed in. writeRevisionCloud itself no-ops for guests. */
  if (revCloudTimer) clearTimeout(revCloudTimer);
  revCloudTimer = setTimeout(function () {
    revCloudTimer = null;
    if (!appState.user) return;
    try { writeRevisionCloud(revLoad()); } catch (e) {}
  }, 4000);
}

export function revMergeEntry(p, q) {
  function stageOf(e) { return e.status === "mastered" ? 99 : e.stage; }
  function ndOf(e) { return e.nextDue || "9999-99-99"; }
  const base = stageOf(q) > stageOf(p) ? q : stageOf(p) > stageOf(q) ? p : (ndOf(q) > ndOf(p) ? q : p);
  const out = JSON.parse(JSON.stringify(base));
  out.countFull = Math.max(p.countFull || 0, q.countFull || 0);
  out.countHalf = Math.max(p.countHalf || 0, q.countHalf || 0);
  out.typed = {}; const tk = {}; Object.keys(p.typed || {}).forEach(function (k) { tk[k] = 1; }); Object.keys(q.typed || {}).forEach(function (k) { tk[k] = 1; });
  Object.keys(tk).forEach(function (k) { out.typed[k] = Math.max((p.typed || {})[k] || 0, (q.typed || {})[k] || 0); });
  out.types = {}; const ty = {}; Object.keys(p.types || {}).forEach(function (k) { ty[k] = 1; }); Object.keys(q.types || {}).forEach(function (k) { ty[k] = 1; });
  Object.keys(ty).forEach(function (k) { out.types[k] = Math.max((p.types || {})[k] || 0, (q.types || {})[k] || 0); });
  out.exams = []; (p.exams || []).concat(q.exams || []).forEach(function (x) { if (out.exams.indexOf(x) < 0) out.exams.push(x); });
  out.firstSeen = (p.firstSeen || "") < (q.firstSeen || "") ? p.firstSeen : q.firstSeen;
  out.lastSeen = (p.lastSeen || "") > (q.lastSeen || "") ? p.lastSeen : q.lastSeen;
  return out;
}
export function revMergeBanks(a, b) {
  const map = {}, order = [];
  [a, b].forEach(function (bk) { (bk.words || []).forEach(function (e) {
    if (!map[e.word]) { map[e.word] = JSON.parse(JSON.stringify(e)); order.push(e.word); }
    else map[e.word] = revMergeEntry(map[e.word], e);
  }); });
  return { words: order.map(function (k) { return map[k]; }), updatedAt: new Date().toISOString() };
}

export function wordErrorType(exp, got, st) {
  exp = exp || ""; got = got || "";
  const caseOnly = exp.toLowerCase() === got.toLowerCase() && exp !== got;
  const punctOnly = exp.replace(/[^A-Za-z0-9]/g, "") === got.replace(/[^A-Za-z0-9]/g, "") && exp !== got;
  const spaceOnly = exp.replace(/\s/g, "") === got.replace(/\s/g, "") && exp !== got && (exp.indexOf(" ") >= 0 || got.indexOf(" ") >= 0);
  if (st === "half") { if (caseOnly) return "capitalisation"; if (punctOnly) return "punctuation"; if (spaceOnly) return "spacing"; return "halfChar"; }
  if (got === "") return "omission";
  if (exp === "") return "insertion";
  if (caseOnly) return "capitalisation";
  if (punctOnly) return "punctuation";
  if (spaceOnly) return "spacing";
  if (exp.length === got.length) return "substitution";
  const d = lev(exp, got);
  if (got.length < exp.length) return d <= exp.length - got.length + 1 ? "omission" : "substitution";
  return d <= got.length - exp.length + 1 ? "insertion" : "substitution";
}

/* revFeed — record a finished test's scored mistakes into the bank.
   Verbatim policy: any new scored error resets the word to stage 0, due
   tomorrow; the bank keeps at most 500 learning words (mastered evicted
   first, then lowest-count learning words). */
export function revFeed(errors, examId) {
  if (!errors || !errors.length) return;
  const bank = revLoad(), today = revToday(); let changed = false;
  errors.forEach(function (er) {
    if (!er.exp) return;
    const type = wordErrorType(er.exp, er.got || "", er.st);
    const key = type === "capitalisation" ? er.exp : er.exp.toLowerCase();
    let e = null;
    bank.words.forEach(function (x) { if (x.word === key) e = x; });
    if (!e) {
      e = { word: key, typed: {}, types: { substitution: 0, omission: 0, insertion: 0, capitalisation: 0, punctuation: 0, spacing: 0, halfChar: 0 },
        countFull: 0, countHalf: 0, exams: [], firstSeen: today, lastSeen: today, stage: 0, nextDue: revAddDays(today, 1), status: "learning" };
      bank.words.push(e);
    }
    if (er.st === "half") e.countHalf = (e.countHalf || 0) + 1; else e.countFull = (e.countFull || 0) + 1;
    if (er.got) e.typed[er.got] = (e.typed[er.got] || 0) + 1;
    e.types[type] = (e.types[type] || 0) + 1;
    if (e.exams.indexOf(examId) < 0) e.exams.push(examId);
    e.lastSeen = today;
    e.status = "learning"; e.stage = 0; e.nextDue = revAddDays(today, 1);
    changed = true;
  });
  if (!changed) return;
  let guard = 0;
  while (bank.words.filter(function (x) { return x.status === "learning"; }).length > 500 && guard++ < 600) {
    const mastered = bank.words.filter(function (x) { return x.status === "mastered"; })
      .sort(function (a, b) { return (a.lastSeen || "") < (b.lastSeen || "") ? -1 : 1; });
    if (mastered.length) { bank.words.splice(bank.words.indexOf(mastered[0]), 1); continue; }
    const learning = bank.words.filter(function (x) { return x.status === "learning"; })
      .sort(function (a, b) { return (a.countFull + 0.5 * a.countHalf) - (b.countFull + 0.5 * b.countHalf); });
    if (learning.length) bank.words.splice(bank.words.indexOf(learning[0]), 1); else break;
  }
  bank.updatedAt = new Date().toISOString();
  revSave(bank);
}

export function revApplyResult(word, passed) {
  const bank = revLoad(); let e = null;
  bank.words.forEach(function (x) { if (x.word === word) e = x; });
  if (!e) return;
  const today = revToday();
  if (passed) {
    if (e.stage >= 3) { e.status = "mastered"; e.nextDue = null; }
    else { const dueMap = { 0: 3, 1: 7, 2: 16 }; e.nextDue = revAddDays(today, dueMap[e.stage] || 3); e.stage++; }
  } else { e.status = "learning"; e.stage = 0; e.nextDue = revAddDays(today, 1); }
  e.lastSeen = today;
  bank.updatedAt = new Date().toISOString();
  revSave(bank);
}

export function revDueList(bank) {
  const today = revToday();
  return bank.words.filter(function (e) { return e.status === "learning" && e.nextDue && e.nextDue <= today; })
    .sort(function (a, b) { return (a.stage - b.stage) || ((b.countFull + 0.5 * (b.countHalf || 0)) - (a.countFull + 0.5 * (a.countHalf || 0))); });
}

/* storedMistakeDetail — verbatim from revision-drills.js: the drill word
   list for a stored entry (mistakeDetail → telemetry words → weakWords). */
export function storedMistakeDetail(en) {
  if (!en) return [];
  if (en.mistakeDetail && en.mistakeDetail.length) return en.mistakeDetail;
  const out = [], seen = {};
  if (en.telemetry && en.telemetry.words) {
    en.telemetry.words.forEach(function (w) { if ((w.st === "full" || w.st === "half") && w.exp && !seen[w.exp]) { seen[w.exp] = 1; out.push({ exp: w.exp, got: w.got || "", st: w.st }); } });
    if (out.length) return out;
  }
  if (en.weakWords) { Object.keys(en.weakWords).forEach(function (w) { if (w && !seen[w]) { seen[w] = 1; out.push({ exp: w, got: "", st: "full" }); } }); }
  return out;
}

export function revBankKey(exp) {
  if (!exp) return null;
  const bank = revLoad(); let found = null; const low = String(exp).toLowerCase();
  bank.words.forEach(function (x) { if (x.word === exp) found = x.word; });
  if (found) return found;
  bank.words.forEach(function (x) { if (String(x.word).toLowerCase() === low) found = x.word; });
  return found;
}
