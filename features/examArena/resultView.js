/* features/examArena/resultView.js — result screen rendering.
   The fresh-result LAYOUT is the redesign's (hero row + secondary grid),
   but every metric, section and string is the current app's, ported
   verbatim from core.js / exams.js / revision-drills.js / views.js:
   ring tiles, the HCM calc table, mistake rows, passage comparison,
   the CGL dual-standard table, stored-result views and the printable
   Result Card (fillResultCard — content identical to today's). */

import { escapeHtml } from "../../components/ProfilePopover.js";
import { fmtNum, dispErrPct, specOf, testsOf } from "../../data/exams.js";
import { fmtTime, hcmBandLabel, classifyPair, wordCountOf } from "../../core/scoringMatrix.js";
import { forensicsHtml, storedMistakeDetail } from "../../core/forensics.js";
import { loadHist } from "../../core/storage.js";
import { appState } from "../../core/state.js";
import { icon } from "../../components/icons.js";

/* ---- ring tiles + sweep (verbatim) ---- */
export function ringTileHtml(valueText, label, pct, color) {
  pct = Math.max(0, Math.min(100, +pct || 0));
  return "<div class='ringStat'><div class='ringWrap'><svg width='76' height='76' viewBox='0 0 76 76' aria-hidden='true'><circle class='ringBg' cx='38' cy='38' r='32' stroke-width='7' fill='none'/><circle class='ringFg' cx='38' cy='38' r='32' stroke-width='7' fill='none' stroke='" + color + "' stroke-linecap='round' stroke-dasharray='201.06' stroke-dashoffset='201.06' data-pct='" + pct + "'/></svg><div class='ringVal'>" + valueText + "</div></div><div class='l'>" + label + "</div></div>";
}
export function animateRings(root) {
  if (!root) return;
  const fgs = root.querySelectorAll(".ringFg"); if (!fgs.length) return;
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    fgs.forEach(function (c) {
      let pct = parseFloat(c.getAttribute("data-pct") || "0") || 0;
      pct = Math.max(0, Math.min(100, pct));
      c.style.strokeDashoffset = String(201.06 * (1 - pct / 100));
    });
  }); });
}

/* ---- passage comparison (verbatim cmpComparisonHtml) ---- */
export function cmpComparisonHtml(eTokens, gTokens, eStat, gStat, counts, halfCatsApply) {
  counts = counts || {};
  const hw = halfCatsApply ? "Half" : "Full";
  const key = [["spelling", "Spelling", "Full"], ["skipped", "Skipped", "Full"], ["extra", "Extra", "Full"], ["capital", "Capitalisation", hw], ["punct", "Punctuation", hw], ["spacing", "Spacing", hw]];
  const chips = key.map(function (k) {
    return "<span class='cmpKey'><span class='cmpDot cw-" + k[0] + "'></span>" + k[1] + " (" + k[2] + ")" + (counts[k[0]] != null ? " · " + counts[k[0]] : "") + "</span>";
  }).join("");
  function panel(tokens, stat) {
    return tokens.map(function (w, idx) {
      const s = stat && stat[idx];
      if (!s || s.st === "ok") return escapeHtml(w);
      return "<span class='cw-" + s.cat + "'>" + escapeHtml(w) + "</span>";
    }).join(" ");
  }
  return "<div class='cmpKeys'>" + chips + "</div><div class='cmpGrid'>"
    + "<div class='cmpPanel'><h4>Original Passage</h4><p>" + panel(eTokens, eStat) + "</p></div>"
    + "<div class='cmpPanel'><h4>Your Typed Passage</h4><p>" + (gTokens.length ? panel(gTokens, gStat) : "(nothing typed)") + "</p></div></div>";
}

/* =====================================================================
   HCM fresh result — the skeleton the engine fills by id, exactly as
   the current finishTest does (ids preserved: rTitle, rVerdict, rNet…). */
export function hcmResultSkeleton() {
  return '<div class="resultBox" id="resultBox" style="display:none">' +
    '<h2 id="rTitle">Result</h2>' +
    '<p id="rVerdict" class="examOnly result-verdict"></p>' +
    '<div class="resultGrid big3 examOnly">' +
      ringTileHtml("0", "Net WPM", 0, "var(--accent)").replace("ringVal'>0<", "ringVal' id='rNet'>0<").replace("data-pct='0'", "data-pct='0' id='rNetRing'") +
      ringTileHtml("0%", "Accuracy", 0, "var(--accent)").replace("ringVal'>0%<", "ringVal' id='rAcc'>0%<").replace("data-pct='0'", "data-pct='0' id='rAccRing'") +
      ringTileHtml("—", "Marks / 25", 0, "var(--pass)").replace("ringVal'>—<", "ringVal' id='rMarks'>—<").replace("data-pct='0'", "data-pct='0' id='rMarksRing'") +
    '</div>' +
    '<div class="resultActions examOnly">' +
      '<button class="btn" id="againBtn" type="button">' + icon("repeat") + 'Type it again</button>' +
      '<button class="btn secondary" id="mistakeBtn" type="button" style="display:none">Practise my mistakes</button>' +
      '<button class="btn secondary" id="nextBtn" type="button">New passage</button>' +
      '<button class="btn secondary" id="rcBtn" type="button">' + icon("printer") + 'Result card</button>' +
    '</div>' +
    '<p id="rCloud" class="rCloud small"></p>' +
    '<div id="pracResult" style="display:none">' +
      '<div class="prBadge" id="prBest" style="display:none">🏆 New personal best!</div>' +
      '<div class="statsGrid prGrid">' +
        '<div class="stat"><div class="v" id="prNet">0</div><div class="l">Net WPM</div></div>' +
        '<div class="stat"><div class="v" id="prAcc">0%</div><div class="l">Accuracy</div></div>' +
        '<div class="stat"><div class="v" id="prTime">0:00</div><div class="l">Time taken</div></div>' +
        '<div class="stat"><div class="v" id="prErr">0</div><div class="l">Errors</div></div>' +
        '<div class="stat"><div class="v" id="prWords">0</div><div class="l">Words</div></div>' +
        '<div class="stat"><div class="v" id="prGross">0</div><div class="l">Gross WPM</div></div>' +
      '</div>' +
      '<p class="prLine" id="prLine"></p>' +
      '<p class="prTarget" id="prTarget" style="display:none"></p>' +
      '<div class="prActions">' +
        '<button class="btn" id="prNextBtn" type="button">Next →</button>' +
        '<button class="btn secondary" id="prAgainBtn" type="button">' + icon("repeat") + 'Retake</button>' +
        '<button class="btn secondary" id="prBackBtn" type="button">Back to list</button>' +
      '</div>' +
    '</div>' +
    '<div class="resultGrid examOnly statsGrid">' +
      '<div class="stat"><div class="v" id="rGross">0</div><div class="l">Gross WPM</div></div>' +
      '<div class="stat"><div class="v" id="rKeys">0</div><div class="l">Keystrokes</div></div>' +
      '<div class="stat"><div class="v" id="rBs">0</div><div class="l">Backspaces</div></div>' +
      '<div class="stat"><div class="v" id="rTimeUsed">0:00</div><div class="l">Time used</div></div>' +
      '<div class="stat"><div class="v" id="rWordsN">0</div><div class="l">Words typed</div></div>' +
    '</div>' +
    '<div id="rCalc" class="examOnly"></div>' +
    '<div id="rMistakes" class="examOnly" style="margin-top:14px"></div>' +
    '<div id="rCompare" class="examOnly"></div>' +
    '<div class="grid2 examOnly">' +
      '<div><h3>Error breakdown</h3><table><tbody id="rBreak"></tbody></table></div>' +
      '<div><h3>Weakest keys &amp; words</h3><p id="rWeak" class="small"></p>' +
      '<h3 style="margin-top:12px">What to drill next</h3><p id="rNext" class="small"></p></div>' +
    '</div>' +
    '<div id="rForensics" class="examOnly"></div>' +
  '</div>';
}

/* =====================================================================
   Exam-engine fresh result — verbatim renderExamResult (exams.js),
   with the redesign's action set (Practise My Mistakes routes to
   Progress; the words are already in the revision bank via revFeed). */
export function renderExamResultInto(el, r, handlers) {
  const sp = r.sp, sc = r.sc;
  let h = "<button class='pill' type='button' id='xrBack'>← Back to " + sp.short + " hub</button>";
  h += "<h1 style='font-size:26px;margin-top:12px'>" + sp.name + " — " + escapeHtml(r.t.name) + "</h1>";
  h += "<p><span class='statusChip " + (r.qual ? "q" : "nq") + "'>" + (r.qual ? "✓ Qualified" : "✗ Not qualified") + "</span></p><p class='sub'>" + escapeHtml(r.reason) + "</p>";
  if (sp.id === "cgl") h += cglDualTableHtml(r);
  h += "<div class='card'><h2>Performance Summary</h2><div class='statsGrid'>"
    + (sp.engine === "E1"
      ? ringTileHtml(dispErrPct(r.errPct).toFixed(1) + "%", "Error %", Math.min(100, r.errPct), r.qual ? "var(--pass)" : "var(--error)")
        + ringTileHtml(String(Math.round(r.gross)), "Gross WPM", Math.min(100, r.gross / 2), "var(--accent)")
        + ringTileHtml(String(Math.round(r.netInd)), "Net WPM", Math.min(100, r.netInd / 2), "var(--accent)")
        + ringTileHtml(r.acc.toFixed(1) + "%", "Accuracy", r.acc, "var(--accent)")
      : ringTileHtml(r.net.toFixed(1), "Net WPM", Math.min(100, r.net / 2), "var(--accent)")
        + ringTileHtml(String(Math.round(r.gross)), "Gross WPM", Math.min(100, r.gross / 2), "var(--accent)")
        + ringTileHtml(r.acc.toFixed(1) + "%", "Accuracy", r.acc, "var(--accent)")
        + ringTileHtml(dispErrPct(r.errPct).toFixed(1) + "%", "Error %", Math.min(100, r.errPct), r.qual ? "var(--pass)" : "var(--error)"))
    + "<div class='stat'><div class='v'>" + sc.full + "</div><div class='l'>Full mistakes</div></div>"
    + "<div class='stat'><div class='v'>" + sc.half + "</div><div class='l'>Half mistakes</div></div>"
    + "<div class='stat'><div class='v'>" + r.words5 + "</div><div class='l'>Words typed</div></div>"
    + "<div class='stat'><div class='v'>" + fmtNum(r.typedText.length) + "</div><div class='l'>Keystrokes</div></div>"
    + "<div class='stat'><div class='v'>" + fmtTime(Math.round(r.el)) + "</div><div class='l'>Time used</div></div>"
    + "<div class='stat'><div class='v'>" + sc.completion.toFixed(0) + "%</div><div class='l'>Passage completed</div></div>"
    + "</div><p class='small'>" + (sp.engine === "E1"
      ? "Untyped passage words count as skipped full mistakes — as in the real skill test."
      : "Scoring covers what you typed; untyped text is not penalised.") + "</p></div>";
  h += "<div class='card'><h2>Mistake Calculation</h2><ol style='padding-left:20px;margin:6px 0'>";
  const wtd = sc.full + 0.5 * sc.half;
  if (sp.engine === "E1") {
    h += "<li>Full mistakes: <strong>" + sc.full + "</strong> · Half mistakes: <strong>" + sc.half + "</strong> (weighted " + wtd.toFixed(1) + ").</li>"
      + "<li>Words = keystrokes typed ÷ 5 = " + fmtNum(r.typedText.length) + " ÷ 5 = <strong>" + r.words5 + "</strong>.</li>"
      + "<li>Error % = (Full + 0.5 × Half) ÷ words × 100 = (" + sc.full + " + " + (0.5 * sc.half).toFixed(1) + ") ÷ " + r.words5 + " × 100 = <strong>" + dispErrPct(r.errPct).toFixed(2) + "%</strong>" + (r.errPct > 100 ? " — the raw figure is " + r.errPct.toFixed(1) + "%, shown capped at 100%, as the exam portal shows it." : " (shown as " + dispErrPct(r.errPct).toFixed(1) + "% in the tiles above).") + "</li>"
      + "<li>Net WPM = Gross WPM = <strong>" + r.gross.toFixed(2) + " WPM</strong> — SSC verdicts are decided by error %; mistakes do not deduct from speed in this pattern.</li>"
      + "<li>Your category cap (" + r.cat.label + "): <strong>" + r.cat.cap + "%</strong>.</li>";
  } else {
    h += "<li>Full mistakes: <strong>" + sc.full + "</strong> · Half mistakes: <strong>" + sc.half + "</strong> (weighted " + wtd.toFixed(1) + ").</li>"
      + "<li>Words = keystrokes typed ÷ 5 = " + fmtNum(r.typedText.length) + " ÷ 5 = <strong>" + r.words5 + "</strong>.</li>"
      + "<li>Penalty-free allowance = 5% of words = 5% × " + r.words5 + " = <strong>" + r.allowance.toFixed(2) + "</strong>.</li>"
      + "<li>Final Mistakes = max(0, (Full + 0.5 × Half) − allowance) = max(0, " + wtd.toFixed(1) + " − " + r.allowance.toFixed(2) + ") = <strong>" + r.finalM.toFixed(2) + "</strong> (never below zero).</li>"
      + "<li>Net Speed = (Words − Final Mistakes × 10) ÷ minutes = (" + r.words5 + " − " + (r.finalM * 10).toFixed(1) + ") ÷ " + r.mins.toFixed(3) + " = <strong>" + r.net.toFixed(1) + " WPM</strong>.</li>";
  }
  h += "</ol></div>";
  const cats = sc.cats || { spelling: sc.wrong, capital: 0, punct: 0, spacing: 0, skipped: sc.skipped, extra: sc.extra };
  h += "<div class='card'><h2>Error Breakdown</h2><table><tbody>"
    + "<tr><td>Spelling (full)</td><td><strong>" + cats.spelling + "</strong></td></tr>"
    + "<tr><td>Skipped words (full)</td><td><strong>" + cats.skipped + "</strong></td></tr>"
    + "<tr><td>Extra words (full)</td><td><strong>" + cats.extra + "</strong></td></tr>"
    + "<tr><td>Capitalisation (half)</td><td><strong>" + cats.capital + "</strong></td></tr>"
    + "<tr><td>Punctuation (half)</td><td><strong>" + cats.punct + "</strong></td></tr>"
    + "<tr><td>Spacing (half)</td><td><strong>" + cats.spacing + "</strong></td></tr></tbody></table></div>";
  const eToks = r.target.split(/\s+/).filter(Boolean), gToks = r.typedText.split(/\s+/).filter(Boolean);
  h += "<div class='card'><h2>Passage Comparison</h2>" + cmpComparisonHtml(eToks, gToks, sc.eStat, sc.gStat, cats, true) + "</div>";
  if (r.tel) {
    const fxCtx = sp.engine === "E1"
      ? { engine: "E1", examId: sp.id, netWpm: r.netInd, grossWpm: r.gross, acc: r.acc, chars: r.typedText.length, errorPct: r.errPct, cap: r.cat.cap, catLabel: r.cat.label, completion: sc.completion, wordsTyped: sc.wordsTyped }
      : { engine: "E2", examId: sp.id, netWpm: r.net, grossWpm: r.gross, acc: r.acc, chars: r.typedText.length, errorPct: r.errPct, completion: sc.completion, wordsTyped: sc.wordsTyped, evaluated: r.evaluated };
    h += forensicsHtml(r.tel, fxCtx);
  }
  h += "<div style='display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px'><button class='btn' id='xrRetake' type='button'>↻ Retake this test</button>"
    + ((sc.full + sc.half) > 0 ? "<button class='btn secondary' id='xrDrill' type='button'>Practise my mistakes</button>" : "")
    + "<button class='btn secondary' type='button' id='xrProgress'>📊 Progress</button></div>";
  el.innerHTML = h;
  animateRings(el);
  el.querySelector("#xrBack").addEventListener("click", function () { handlers.onBack(); });
  el.querySelector("#xrRetake").addEventListener("click", function () { handlers.onRetake(); });
  const xrD = el.querySelector("#xrDrill"); if (xrD) xrD.addEventListener("click", function () { handlers.onPractise(); });
  el.querySelector("#xrProgress").addEventListener("click", function () { handlers.onProgress(); });
}

export function cglDualTableHtml(r) {
  const err = r.errPct, myCat = r.cat ? r.cat.id : "";
  function cell(label, cap, own) {
    const pass = err <= cap;
    return "<td" + (own ? " style='background:var(--accent-soft);font-weight:700'" : "") + ">" + label + " ≤ " + cap + "% — " + (pass ? "Passed" : "Practice more") + "</td>";
  }
  const hiOwn = myCat === "UR" ? "UR" : "OTH";
  return "<div class='card'><h2>Your standing under both DEST standards</h2><div style='overflow-x:auto'><table><tbody>"
    + "<tr><td style='font-weight:700'>Non-CPT + Non-DEST</td>" + cell("UR", 20, myCat === "UR") + cell("OBC / EWS", 25, myCat === "OBC-EWS") + cell("Others", 30, myCat === "Others") + "</tr>"
    + "<tr><td style='font-weight:700'>CPT + DEST — higher standard</td>" + cell("UR", 5, hiOwn === "UR") + cell("Others", 7, hiOwn === "OTH") + "<td>PwBD ≤ 10% — " + (err <= 10 ? "Passed" : "Practice more") + "</td></tr>"
    + "</tbody></table></div><p class='small' style='margin:8px 0 0'>Your headline verdict above uses the Non-CPT + Non-DEST cap for your chosen category — the same standard this site has always applied. The higher-standard row is shown for posts that demand it.</p></div>";
}

/* =====================================================================
   Stored results (hub "Result" buttons) — verbatim ports of
   renderStoredResult (exams.js) and renderStoredHcmResult
   (revision-drills.js). */
export function renderStoredExamResultInto(el, en, handlers) {
  const sp = specOf(en.examId); if (!sp) return;
  const t = testsOf(en.examId).find(function (x) { return x.id === en.testId; }) || { name: en.name };
  const qual = (en.verdict || "").indexOf("Qualified") === 0;
  let h = "<button class='pill' type='button' id='xrBack2'>← Back to " + sp.short + " hub</button>";
  h += "<h1 style='font-size:26px;margin-top:12px'>" + sp.name + " — " + escapeHtml(t.name) + "</h1>";
  h += "<p><span class='statusChip " + (qual ? "q" : "nq") + "'>" + (qual ? "✓ Qualified" : "✗ " + escapeHtml((en.verdict || "Result").split(" — ")[0])) + "</span></p><p class='sub'>" + escapeHtml(en.verdict || "") + "</p>";
  h += "<div class='card'><h2>Performance Summary</h2><div class='statsGrid'>"
    + "<div class='stat'><div class='v'>" + (en.errorPct != null ? dispErrPct(en.errorPct).toFixed(1) + "%" : "—") + "</div><div class='l'>Error %</div></div>"
    + "<div class='stat'><div class='v'>" + (en.gross || 0) + "</div><div class='l'>Gross WPM</div></div>"
    + "<div class='stat'><div class='v'>" + (en.net || 0) + "</div><div class='l'>Net WPM" + (sp.engine === "E1" ? " (indicative)" : "") + "</div></div>"
    + "<div class='stat'><div class='v'>" + (+en.acc || 0).toFixed(1) + "%</div><div class='l'>Accuracy</div></div>"
    + "<div class='stat'><div class='v'>" + (en.full || 0) + "</div><div class='l'>Full mistakes</div></div>"
    + "<div class='stat'><div class='v'>" + (en.half || 0) + "</div><div class='l'>Half mistakes</div></div>"
    + "<div class='stat'><div class='v'>" + (en.words || 0) + "</div><div class='l'>Words typed</div></div>"
    + "<div class='stat'><div class='v'>" + fmtNum(en.chars || 0) + "</div><div class='l'>Keystrokes</div></div></div>"
    + (en.category ? "<p class='small'>Category: <strong>" + escapeHtml(en.category) + "</strong> · Attempted " + escapeHtml(en.d || "") + "</p>" : "<p class='small'>Attempted " + escapeHtml(en.d || "") + "</p>")
    + "</div>";
  if (en.telemetry) {
    const catS = sp.categories ? (sp.categories.find(function (c) { return c.id === en.category; }) || sp.categories[0]) : null;
    const expW = t.text ? wordCountOf(t.text) : 0;
    const compS = (en.telemetry.words && expW) ? Math.min(100, en.telemetry.words.length / expW * 100) : null;
    const sCtx = sp.engine === "E1"
      ? { engine: "E1", examId: sp.id, netWpm: en.net || 0, grossWpm: en.gross || 0, acc: +en.acc || 0, chars: en.chars || 0, errorPct: (en.errorPct != null ? en.errorPct : 0), cap: catS ? catS.cap : 0, catLabel: catS ? catS.label : "", completion: compS, wordsTyped: en.words || 0 }
      : { engine: "E2", examId: sp.id, netWpm: en.net || 0, grossWpm: en.gross || 0, acc: +en.acc || 0, chars: en.chars || 0, errorPct: (en.errorPct != null ? en.errorPct : 0), completion: compS, wordsTyped: en.words || 0, evaluated: true };
    h += forensicsHtml(en.telemetry, sCtx);
  } else {
    h += "<div class='card'><p class='small' style='margin:0'>Detailed analysis is available for tests taken after the Phase 3 update.</p></div>";
  }
  h += "<div style='display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px'><button class='btn' id='xrRetake2' type='button'>↻ Retake this test</button>"
    + (((en.full || 0) + (en.half || 0)) > 0 || storedMistakeDetail(en).length ? "<button class='btn secondary' id='xrDrill2' type='button'>Practise my mistakes</button>" : "")
    + "<button class='btn secondary' type='button' id='xrProgress2'>📊 Progress</button></div>";
  el.innerHTML = h;
  el.querySelector("#xrBack2").addEventListener("click", function () { handlers.onBack(); });
  el.querySelector("#xrRetake2").addEventListener("click", function () { if (t.id) handlers.onRetake(t); });
  const xrD2 = el.querySelector("#xrDrill2"); if (xrD2) xrD2.addEventListener("click", function () { handlers.onPractise(); });
  el.querySelector("#xrProgress2").addEventListener("click", function () { handlers.onProgress(); });
}

export function renderStoredHcmResultInto(el, en, handlers) {
  const qual = (+en.net || 0) >= 30;
  const catNames = { spelling: "Spelling / wrong character", capital: "Capitalisation", punct: "Punctuation", spacing: "Spacing", other: "Other / extra–omitted" };
  let h = "<button class='pill' type='button' id='xrBack3'>← Back to Progress</button>";
  h += "<h1 style='font-size:26px;margin-top:12px'>" + escapeHtml(en.name || "Typing test") + "</h1>";
  h += "<p><span class='statusChip " + (qual ? "q" : "nq") + "'>" + (qual ? "✓ Qualified" : "✗ Below qualifying speed") + "</span></p>"
    + "<p class='sub'>" + escapeHtml(hcmBandLabel(+en.net || 0)) + " · Attempted " + escapeHtml(en.d || "") + "</p>";
  h += "<div class='card'><h2>Performance Summary</h2><div class='statsGrid'>"
    + "<div class='stat'><div class='v'>" + Math.round(en.net || 0) + "</div><div class='l'>Net WPM</div></div>"
    + "<div class='stat'><div class='v'>" + (+en.acc || 0).toFixed(1) + "%</div><div class='l'>Accuracy</div></div>"
    + "<div class='stat'><div class='v'>" + (qual ? (en.marks || 0) + " / 25" : "0 (DQ)") + "</div><div class='l'>Marks</div></div>"
    + "<div class='stat'><div class='v'>" + (en.gross || 0) + "</div><div class='l'>Gross WPM</div></div>"
    + "<div class='stat'><div class='v'>" + fmtNum(en.chars || 0) + "</div><div class='l'>Keystrokes typed</div></div>"
    + "<div class='stat'><div class='v'>" + (en.bs || 0) + "</div><div class='l'>Backspaces used</div></div>"
    + "<div class='stat'><div class='v'>" + fmtTime(en.durSec || ((en.min || 0) * 60)) + "</div><div class='l'>Time used</div></div>"
    + "<div class='stat'><div class='v'>" + (en.words || 0) + "</div><div class='l'>Words typed</div></div>"
    + "<div class='stat'><div class='v'>" + (en.errs || 0) + "</div><div class='l'>Full mistakes</div></div>"
    + "</div></div>";
  if (en.errCat) {
    let rowsB = ""; Object.keys(catNames).forEach(function (k) { rowsB += "<tr><td>" + catNames[k] + "</td><td><strong>" + (en.errCat[k] || 0) + "</strong></td></tr>"; });
    rowsB += "<tr><td><strong>Total errors</strong></td><td><strong>" + (en.errs || 0) + "</strong></td></tr>";
    h += "<div class='card'><h2>Error breakdown</h2><table><tbody>" + rowsB + "</tbody></table></div>";
  }
  const wkS = Object.keys(en.weakKeys || {}).sort(function (a, b) { return en.weakKeys[b] - en.weakKeys[a]; }).slice(0, 6)
    .map(function (k) { return "'" + (k === " " ? "space" : escapeHtml(k)) + "' ×" + en.weakKeys[k]; }).join(", ");
  const wwS = Object.keys(en.weakWords || {}).sort(function (a, b) { return en.weakWords[b] - en.weakWords[a]; }).slice(0, 6)
    .map(function (k) { return escapeHtml(k) + " ×" + en.weakWords[k]; }).join(", ");
  if (wkS || wwS) h += "<div class='card'><h2>Weakest keys &amp; words</h2><p class='small' style='margin:0'>" + (wkS ? "Weakest keys: <strong>" + wkS + "</strong><br>" : "") + (wwS ? "Words with errors: <strong>" + wwS + "</strong>" : "") + "</p></div>";
  if (en.telemetry) {
    h += forensicsHtml(en.telemetry, { engine: "E3", examId: "hcm", netWpm: +en.net || 0, grossWpm: +en.gross || 0, acc: +en.acc || 0, chars: en.chars || 0, completion: null, wordsTyped: en.words || 0 });
  } else {
    h += "<div class='card'><p class='small' style='margin:0'>Detailed analysis is available for tests taken after the Phase 3 update.</p></div>";
  }
  h += "<div style='display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px'><button class='btn' type='button' id='xrRetake3'>⌨️ New test</button>"
    + (storedMistakeDetail(en).length ? "<button class='btn secondary' id='xrDrill3' type='button'>Practise my mistakes</button>" : "")
    + "<button class='btn secondary' type='button' id='xrProgress3'>📊 Progress</button></div>";
  el.innerHTML = h;
  el.querySelector("#xrBack3").addEventListener("click", function () { handlers.onProgress(); });
  el.querySelector("#xrRetake3").addEventListener("click", function () { handlers.onBack(); });
  const xrD3 = el.querySelector("#xrDrill3"); if (xrD3) xrD3.addEventListener("click", function () { handlers.onPractise(); });
  el.querySelector("#xrProgress3").addEventListener("click", function () { handlers.onProgress(); });
}

/* hcmEntryForTest — verbatim lookup policy from revision-drills.js:
   history by testId first, then by display name among HCM entries. */
export function hcmEntryForTest(testId) {
  const h = loadHist(); let i;
  for (i = 0; i < h.length; i++) { if (h[i].testId === testId) return h[i]; }
  const it = testsOf("hcm").find(function (x) { return x.id === testId; });
  if (it) { for (i = 0; i < h.length; i++) { if (!h[i].examId && h[i].name === it.name) return h[i]; } }
  return null;
}

/* =====================================================================
   Printable Result Card — fillResultCard ported verbatim from views.js.
   Content identical to today's card; only the chrome is new. */
function resultCardName() {
  if (!appState.user) return "";
  return (appState.accountName || "").trim() || (appState.user.displayName || "").trim();
}
export function fillResultCard() {
  const r = window.__lastResult, tb = document.getElementById("rcBody"); if (!tb) return;
  const nm = resultCardName();
  if (!r) { tb.innerHTML = "<tr><td colspan='2'>Finish a typing test first — your result card will appear here.</td></tr>"; return; }
  const rows = [
    ["Date", r.date || ""],
    ["Test", r.name || ""],
    ["Duration", (r.min || "") + " min · " + (r.durSec || 0) + " seconds used"],
    ["Gross WPM", r.gross], ["Net WPM", r.net], ["Accuracy", (+r.acc || 0).toFixed(1) + "%"],
    ["Errors", r.errs], ["Marks", (r.net >= 30 ? (r.marks || 0) + " / 25" : "0 — below qualifying (DQ)")],
    ["Marks band", r.band || ""]
  ];
  if (nm) rows.unshift(["Name", nm]);
  tb.innerHTML = rows.map(function (x) { return "<tr><td style='font-weight:700;width:38%'>" + escapeHtml(String(x[0])) + "</td><td>" + escapeHtml(String(x[1])) + "</td></tr>"; }).join("");
}
export function openResultCard() {
  let ov = document.getElementById("rcOverlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "rcOverlay";
    ov.className = "rc-overlay";
    ov.setAttribute("aria-hidden", "true");
    ov.innerHTML = '<div class="rc-card"><div class="rc-head"><h2>Result Card</h2>' +
      '<span class="rc-brand">TypeSetu</span></div>' +
      '<table class="rc-table"><tbody id="rcBody"></tbody></table>' +
      '<div class="rc-actions"><button class="btn" type="button" id="rcPrint">' + icon("printer") + 'Print</button>' +
      '<button class="btn secondary" type="button" id="rcClose">Close</button></div></div>';
    document.body.appendChild(ov);
    ov.querySelector("#rcClose").addEventListener("click", closeResultCard);
    ov.querySelector("#rcPrint").addEventListener("click", function () { window.print(); });
    ov.addEventListener("click", function (e) { if (e.target === ov) closeResultCard(); });
  }
  fillResultCard();
  ov.classList.add("open"); ov.setAttribute("aria-hidden", "false");
  document.body.classList.add("rcOpen");
}
export function closeResultCard() {
  const ov = document.getElementById("rcOverlay");
  if (ov) { ov.classList.remove("open"); ov.setAttribute("aria-hidden", "true"); }
  document.body.classList.remove("rcOpen");
}
