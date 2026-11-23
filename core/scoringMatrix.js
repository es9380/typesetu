/* core/scoringMatrix.js — the Result Accuracy Matrix.
   Every function here is a VERBATIM port of the audited scoring code from
   the current live app (core.js HCM alignment + exams.js word scoring).
   The math is never "improved", only moved — Stage 0 golden values
   (~/workspace/typesetu-redesign-tests/golden.json) are the law and the
   Stage 2 driver diffs against them exactly. */

import { specOf } from "../data/exams.js";

/* HCM marks bands — verbatim port of marksFor() from the current core.js. */
export function hcmMarksFor(net) {
  if (net < 30) return 0; if (net < 31) return 10; if (net <= 35) return 12; if (net <= 40) return 15;
  if (net <= 45) return 18; if (net <= 50) return 21; return 25;
}

/* bandLabel() — verbatim from the current core.js. */
export function hcmBandLabel(n) {
  if (n < 30) return "below 30 net WPM — disqualified (0 marks)";
  if (n < 31) return "30 net WPM band — 10 marks";
  if (n <= 35) return "31–35 band — 12 marks";
  if (n <= 40) return "36–40 band — 15 marks";
  if (n <= 45) return "41–45 band — 18 marks";
  if (n <= 50) return "46–50 band — 21 marks";
  return "51+ band — full 25 marks";
}

/* fmtTime() — verbatim from the current core.js (ceil semantics). */
export function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }

export function wordCountOf(s) { return (s || "").split(/\s+/).filter(Boolean).length; }

/* HCM slab segments for the Home slab bar (derived from the bands above and
   the spec formula text — display only). */
export const HCM_SLABS = [
  { marks: 0, range: "< 30", label: "Below 30 WPM", kind: "dq" },
  { marks: 10, range: "30", label: "30 WPM", kind: "" },
  { marks: 12, range: "31–35", label: "31–35 WPM", kind: "" },
  { marks: 15, range: "36–40", label: "36–40 WPM", kind: "" },
  { marks: 18, range: "41–45", label: "41–45 WPM", kind: "" },
  { marks: 21, range: "46–50", label: "46–50 WPM", kind: "" },
  { marks: 25, range: "51+", label: "51+ WPM", kind: "top" }
];

/* CGL's tighter second standard (CPT + DEST posts) — from the spec formula. */
export const CGL_CPT_CATEGORIES = [
  { id: "CPT-UR", label: "UR", cap: 5 },
  { id: "CPT-Others", label: "Others", cap: 7 },
  { id: "CPT-PwBD", label: "PwBD", cap: 10 }
];

/* Slab model for Home, per exam, derived from EXAM_SPECS:
   - marks exams (HCM): band segments.
   - error-cap exams (CHSL/CGL): the category caps (+ CGL's CPT standard).
   - net-pass exams (RRB): the pass rule with its 5% free allowance. */
export function slabFor(examId) {
  const sp = specOf(examId);
  if (!sp) return null;
  if (examId === "hcm") return { kind: "marks", title: "Marks by net WPM", segments: HCM_SLABS, note: sp.nature + " · " + sp.errorAllowance };
  if (examId === "rrb") {
    return {
      kind: "pass", title: "Qualifying rule",
      headline: "Net speed ≥ " + sp.targetWPM + " WPM",
      note: "First 5% of words are penalty-free · Backspace disabled · " + sp.durationLabel
    };
  }
  const groups = [{ title: sp.evaluation, categories: sp.categories || [] }];
  if (examId === "cgl") groups.push({ title: "Higher standard (CPT + DEST posts)", categories: CGL_CPT_CATEGORIES });
  return { kind: "caps", title: "Error % caps by category", groups: groups, note: sp.penaltyLabel };
}

/* =====================================================================
   HCM word alignment — verbatim port of hcmWordTokens + alignWordsHcm
   from the current core.js (prefix-weighted DP alignment, kStar partial
   alignment, trailing partial-word rule, spacing collapse). */

export function hcmWordTokens(str) {
  const out = []; let m; const re = /\S+/g;
  while ((m = re.exec(str || "")) !== null) out.push({ w: m[0], s: m.index, e: m.index + m[0].length });
  return out;
}

export function alignWordsHcm(target, typedStr) {
  const T = hcmWordTokens(target), G = hcmWordTokens(typedStr);
  const n = T.length, m = G.length;
  let i, j;
  const Tw = [], Gw = [];
  for (i = 0; i < n; i++) Tw.push(T[i].w);
  for (j = 0; j < m; j++) Gw.push(G[j].w);
  function posMatches(a, b) { let c = 0; const lim = Math.min(a.length, b.length); for (let q = 0; q < lim; q++) { if (a[q] === b[q]) c++; } return c; }
  function prefixLen(a, b) { let c = 0; const lim = Math.min(a.length, b.length); while (c < lim && a[c] === b[c]) c++; return c; }

  const tIdx = {}, gIdx = {}, tUniq = [], gUniq = [], tSeq = new Int32Array(n), gSeq = new Int32Array(m);
  for (i = 0; i < n; i++) { const w1 = Tw[i]; if (tIdx[w1] === undefined) { tIdx[w1] = tUniq.length; tUniq.push(w1); } tSeq[i] = tIdx[w1]; }
  for (j = 0; j < m; j++) { const w2 = Gw[j]; if (gIdx[w2] === undefined) { gIdx[w2] = gUniq.length; gUniq.push(w2); } gSeq[j] = gIdx[w2]; }
  const gu = gUniq.length, C = new Float64Array(tUniq.length * gu);
  for (i = 0; i < tUniq.length; i++) for (j = 0; j < gu; j++) {
    C[i * gu + j] = tUniq[i] === gUniq[j] ? 0 : 1 - 0.01 * (prefixLen(tUniq[i], gUniq[j]) / Math.max(tUniq[i].length, gUniq[j].length));
  }
  const Wd = m + 1, D = new Float64Array((n + 1) * Wd);
  for (i = 0; i <= n; i++) D[i * Wd] = i;
  for (j = 0; j <= m; j++) D[j] = j;
  for (i = 1; i <= n; i++) {
    const ri = i * Wd, rp = (i - 1) * Wd, crow = tSeq[i - 1] * gu;
    for (j = 1; j <= m; j++) {
      const a = D[rp + j - 1] + C[crow + gSeq[j - 1]], b = D[rp + j] + 1, c = D[ri + j - 1] + 1;
      D[ri + j] = a < b ? (a < c ? a : c) : (b < c ? b : c);
    }
  }

  let kStar = 0; for (i = 1; i <= n; i++) { if (D[i * Wd + m] < D[kStar * Wd + m] - 1e-9) kStar = i; }
  const pairs = []; i = kStar; j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && Math.abs(D[i * Wd + j] - (D[(i - 1) * Wd + j - 1] + C[tSeq[i - 1] * gu + gSeq[j - 1]])) < 1e-9) {
      pairs.push({ kind: (Tw[i - 1] === Gw[j - 1] ? "ok" : "sub"), exp: Tw[i - 1], got: Gw[j - 1], ti: i - 1, gi: j - 1 });
      i--; j--;
    } else if (i > 0 && (j === 0 || Math.abs(D[i * Wd + j] - (D[(i - 1) * Wd + j] + 1)) < 1e-9)) {
      pairs.push({ kind: "del", exp: Tw[i - 1], got: "", ti: i - 1, gi: -1 });
      i--;
    } else if (j > 0) {
      pairs.push({ kind: "ins", exp: "", got: Gw[j - 1], ti: -1, gi: j - 1 });
      j--;
    } else break;
  }
  pairs.reverse();

  let lastPaired = -1;
  pairs.forEach(function (p) { if (p.gi >= 0 && p.ti > lastPaired) lastPaired = p.ti; });
  let mistakes = 0, incorrectChars = 0; const kept = []; let spanWords = 0;
  T.forEach(function (tk) { if (tk.s < (typedStr || "").length) spanWords++; });
  pairs.forEach(function (p) {
    if (p.kind === "del" && p.ti > lastPaired) return;
    if (p.kind === "sub" && p.gi === m - 1 && p.got.length < p.exp.length && p.exp.indexOf(p.got) === 0) {
      p = { kind: "ok", exp: p.exp, got: p.got, ti: p.ti, gi: p.gi };
    }
    if (p.kind === "sub") { mistakes++; incorrectChars += p.got.length - posMatches(p.exp, p.got); }
    else if (p.kind === "del") { mistakes++; }
    else if (p.kind === "ins") { mistakes++; incorrectChars += p.got.length; }
    kept.push(p);
  });

  const collapsed = []; let ci2 = 0, didCollapse = false;
  while (ci2 < kept.length) {
    const a = kept[ci2], b = kept[ci2 + 1];
    if (b) {
      if ((a.kind === "sub" && b.kind === "del" && a.exp + b.exp === a.got) || (a.kind === "del" && b.kind === "sub" && a.exp + b.exp === b.got)) {
        const subP = (a.kind === "sub") ? a : b;
        collapsed.push({ kind: "spacing", exp: a.exp + " " + b.exp, got: subP.got, ti: a.ti, gi: subP.gi });
        ci2 += 2; didCollapse = true; continue;
      }
      if ((a.kind === "sub" && b.kind === "ins" && a.exp === a.got + b.got) || (a.kind === "ins" && b.kind === "sub" && b.exp === a.got + b.got)) {
        const subQ = (a.kind === "sub") ? a : b;
        collapsed.push({ kind: "spacing", exp: subQ.exp, got: a.got + " " + b.got, ti: subQ.ti, gi: a.gi });
        ci2 += 2; didCollapse = true; continue;
      }
    }
    collapsed.push(a); ci2++;
  }
  if (didCollapse) {
    let kp = collapsed; mistakes = 0; incorrectChars = 0;
    kp.forEach(function (p) {
      if (p.kind === "sub") { mistakes++; incorrectChars += p.got.length - posMatches(p.exp, p.got); }
      else if (p.kind === "del") { mistakes++; }
      else if (p.kind === "ins") { mistakes++; incorrectChars += p.got.length; }
      else if (p.kind === "spacing") { mistakes++; incorrectChars += p.got.length; }
    });
    return { pairs: kp, mistakes: mistakes, correctChars: (typedStr || "").length - incorrectChars, wordsTyped: m, spanWords: spanWords, typedChars: (typedStr || "").length };
  }
  const typedChars = (typedStr || "").length;
  return { pairs: kept, mistakes: mistakes, correctChars: typedChars - incorrectChars, wordsTyped: m, spanWords: spanWords, typedChars: typedChars };
}

/* Per-character ok flags from the alignment — verbatim displayFlagsHcm. */
export function displayFlagsHcm(target, typedStr) {
  const flags = []; let q;
  for (q = 0; q < typedStr.length; q++) flags.push(true);
  const al = alignWordsHcm(target, typedStr);
  const G = hcmWordTokens(typedStr);
  const byGi = {};
  al.pairs.forEach(function (p) { if (p.gi >= 0) byGi[p.gi] = p; });
  G.forEach(function (tk, gi) {
    const p = byGi[gi]; let c;
    if (!p) return;
    if (p.kind === "ins") { for (c = tk.s; c < tk.e; c++) flags[c] = false; return; }
    if (p.kind !== "ok" && p.kind !== "sub") return;
    for (c = tk.s; c < tk.e; c++) {
      const rel = c - tk.s;
      flags[c] = rel < p.exp.length && p.exp.charAt(rel) === tk.w.charAt(rel);
    }
  });
  return flags;
}

/* Char-level error classifier — verbatim classify() from the current core.js. */
export function classifyChar(exp, got) {
  if (exp === " " || got === " ") return "spacing";
  if (/[.,;:!?'"()\/\-]/.test(exp) || /[.,;:!?'"()\/\-]/.test(got)) return "punct";
  if (exp.toLowerCase() === got.toLowerCase() && exp !== got) return "capital";
  if (/[A-Z]/.test(exp) && /[a-z]/.test(got) && exp.toLowerCase() !== got.toLowerCase()) return "spelling";
  if (/[A-Z]/.test(exp) || /[A-Z]/.test(got)) return "capital";
  return "spelling";
}

/* =====================================================================
   SSC/RRB word scoring — verbatim ports of lev / classifyPair /
   scoreWords from the current exams.js (EzTyping-audited Full/Half
   classification, merge/split spacing halves, partial-test rules via
   opts.countUntypedSkip). */

export function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 3;
  let prev = [], cur = [], i, j;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) { cur[0] = i; for (j = 1; j <= n; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); } const tmp = prev; prev = cur; cur = tmp; }
  return prev[n];
}

export function classifyPair(exp, got) {
  if (exp === got) return "ok";
  if (exp.toLowerCase() === got.toLowerCase()) return "capital";
  const strip = function (s) { return s.replace(/[^A-Za-z0-9]/g, ""); };
  if (strip(exp) === strip(got)) return "punct";
  if (strip(exp).toLowerCase() === strip(got).toLowerCase()) return "capital";
  return "spelling";
}

export function scoreWords(expText, gotText, opts) {
  opts = opts || {};
  const E = expText.split(/\s+/).filter(Boolean), G = gotText.split(/\s+/).filter(Boolean);
  let i = 0, j = 0, full = 0, half = 0, wrong = 0, skipped = 0, extra = 0; const detail = [];
  const cats = { spelling: 0, capital: 0, punct: 0, spacing: 0, skipped: 0, extra: 0 };
  const eStat = [], gStat = [];
  while (i < E.length && j < G.length) {
    if (E[i] === G[j]) { eStat.push({ st: "ok", cat: "ok" }); gStat.push({ st: "ok", cat: "ok" }); i++; j++; continue; }
    if (i + 1 < E.length && E[i] + E[i + 1] === G[j]) {
      half++; cats.spacing++;
      detail.push({ exp: E[i] + " " + E[i + 1], got: G[j], kind: "half", cat: "spacing" });
      eStat.push({ st: "half", cat: "spacing" }); eStat.push({ st: "half", cat: "spacing" });
      gStat.push({ st: "half", cat: "spacing" });
      i += 2; j += 1; continue;
    }
    if (j + 1 < G.length && E[i] === G[j] + G[j + 1]) {
      half++; cats.spacing++;
      detail.push({ exp: E[i], got: G[j] + " " + G[j + 1], kind: "half", cat: "spacing" });
      eStat.push({ st: "half", cat: "spacing" });
      gStat.push({ st: "half", cat: "spacing" }); gStat.push({ st: "half", cat: "spacing" });
      i += 1; j += 2; continue;
    }
    if (i + 1 < E.length && E[i + 1] === G[j]) { skipped++; full++; cats.skipped++; detail.push({ exp: E[i], got: "", kind: "skipped", cat: "skipped" }); eStat.push({ st: "full", cat: "skipped" }); i++; continue; }
    if (j + 1 < G.length && G[j + 1] === E[i]) { extra++; full++; cats.extra++; detail.push({ exp: "", got: G[j], kind: "extra", cat: "extra" }); gStat.push({ st: "full", cat: "extra" }); j++; continue; }
    if (j === G.length - 1 && G[j].length < E[i].length && E[i].indexOf(G[j]) === 0) { eStat.push({ st: "ok", cat: "ok" }); gStat.push({ st: "ok", cat: "ok" }); j++; i++; break; }
    const cat = classifyPair(E[i], G[j]);
    if (cat === "capital" || cat === "punct") { half++; cats[cat]++; detail.push({ exp: E[i], got: G[j], kind: "half", cat: cat }); eStat.push({ st: "half", cat: cat }); gStat.push({ st: "half", cat: cat }); }
    else { full++; wrong++; cats.spelling++; detail.push({ exp: E[i], got: G[j], kind: "wrong", cat: "spelling" }); eStat.push({ st: "full", cat: "spelling" }); gStat.push({ st: "full", cat: "spelling" }); }
    i++; j++;
  }
  while (j < G.length) { extra++; full++; cats.extra++; detail.push({ exp: "", got: G[j], kind: "extra", cat: "extra" }); gStat.push({ st: "full", cat: "extra" }); j++; }
  const consumedE = i;
  if (opts.countUntypedSkip) {
    while (i < E.length) { skipped++; full++; cats.skipped++; detail.push({ exp: E[i], got: "", kind: "skipped", cat: "skipped", tail: true }); eStat.push({ st: "full", cat: "skipped" }); i++; }
  }
  return { full: full, half: half, wrong: wrong, skipped: skipped, extra: extra, detail: detail, wordsTyped: G.length, expWords: E.length, consumedE: consumedE, completion: E.length ? Math.min(100, consumedE / E.length * 100) : 0, cats: cats, eStat: eStat, gStat: gStat };
}
