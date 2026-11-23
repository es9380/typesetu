/* features/progress — Progress (Stage 3): the current Dashboard
   faithfully re-homed — dashboard tiles, the history table with its
   per-entry Result view, Trends (range pills, tiles, goal line,
   charts, error categories, weakest keys/words, insight), and the
   full Revision feature (features/progress/revision.js) running its
   sessions on the shared practice stage. Also the landing point for
   the Arena's "Practise My Mistakes": the pending entry set by the
   Arena is consumed here and the revision session starts at once,
   as on the current site. */

import { loadHist, entryTs, clearAllProgress } from "../../core/storage.js";
import { dashboardStats, trendsSummary } from "../../core/stats.js";
import { cloud } from "../../services/cloudBridge.js";
import { FLAT_TEXTS } from "../../data/drills.js";
import { EXAM_SPECS, specOf } from "../../data/exams.js";
import { mountPracticeStage } from "../../core/examEngine.js";
import { renderStoredExamResultInto, renderStoredHcmResultInto } from "../examArena/resultView.js";
import { icon } from "../../components/icons.js";
import { escapeHtml } from "../../components/ProfilePopover.js";
import { on } from "../../core/state.js";
import {
  registerRevisionSyncHook, renderRevisionInto, beginStreamSession,
  cancelStreamSession, revStreamApply, mistakeSessionWords,
  consumePendingMistakeEntry, bankWordsOnly
} from "./revision.js";

/* ---------------- Trends helpers (verbatim computations) --------------- */
function filteredHist(range, hist) {
  const h = hist.slice().sort(function (a, b) { return new Date(entryTs(a)) - new Date(entryTs(b)); });
  if (range === "all") return h;
  const days = +range, cut = Date.now() - days * 86400000;
  return h.filter(function (x) { const t = new Date(entryTs(x)).getTime(); return !isNaN(t) && t >= cut; });
}
function lineChartSVG(vals, color, unit, targetY, maxY, accScale) {
  if (!vals.length) return "";
  const W = 640, H = 190, PL = 44, PR = 12, PT = 14, PB = 22;
  let dMin = Infinity, dMax = -Infinity;
  vals.forEach(function (v) { dMin = Math.min(dMin, v); dMax = Math.max(dMax, v); });
  let yMin = 0, yMax = maxY || Math.ceil((dMax + 2) / 10) * 10;
  if (accScale && dMax <= 100) {
    yMin = Math.floor((Math.min(dMin, 90) - 3) / 5) * 5; yMin = Math.max(0, Math.min(yMin, 90));
    if (yMax - yMin < 12) { yMax = yMin + 12; }
  }
  if (yMax <= yMin) yMax = yMin + 10;
  const iw = W - PL - PR, ih = H - PT - PB;
  const X = function (i) { return vals.length === 1 ? PL + iw / 2 : PL + iw * i / (vals.length - 1); };
  const Y = function (v) { return PT + ih - (v - yMin) / (yMax - yMin) * ih; };
  let g = "";
  [0, 0.5, 1].forEach(function (f) {
    const v = yMin + (yMax - yMin) * f, y = Y(v);
    g += "<line x1='" + PL + "' y1='" + y + "' x2='" + (W - PR) + "' y2='" + y + "' stroke='var(--border)' stroke-width='1'/>";
    g += "<text x='" + (PL - 6) + "' y='" + (y + 4) + "' text-anchor='end' font-size='10' fill='var(--muted)'>" + Math.round(v) + "</text>";
  });
  if (targetY != null && targetY >= yMin && targetY <= yMax) {
    const y = Y(targetY);
    g += "<line x1='" + PL + "' y1='" + y + "' x2='" + (W - PR) + "' y2='" + y + "' stroke='var(--target)' stroke-width='1.5' stroke-dasharray='5 4'/>";
  }
  let pts = "";
  vals.forEach(function (v, i) { pts += X(i).toFixed(1) + "," + Y(v).toFixed(1) + " "; });
  g += "<polyline fill='none' stroke='" + color + "' stroke-width='2.5' points='" + pts + "'/>";
  vals.forEach(function (v, i) { g += "<circle cx='" + X(i) + "' cy='" + Y(v) + "' r='3.5' fill='" + color + "'/>"; });
  g += "<text x='" + (PL + iw / 2) + "' y='" + (H - 4) + "' text-anchor='middle' font-size='10' fill='var(--muted)'>tests, oldest → newest (" + unit + ")</text>";
  return "<svg viewBox='0 0 " + W + " " + H + "' style='width:100%;height:auto;display:block'>" + g + "</svg>";
}
function barsSVG(vals) {
  if (!vals.length) return "";
  const W = 640, H = 150, PL = 36, PR = 8, PT = 10, PB = 20;
  const iw = W - PL - PR, ih = H - PT - PB, n = vals.length;
  const bw = Math.min(34, iw / n * 0.62), step = iw / n;
  let g = "";
  [0, 12.5, 25].forEach(function (v) {
    const y = PT + ih - v / 25 * ih;
    g += "<line x1='" + PL + "' y1='" + y + "' x2='" + (W - PR) + "' y2='" + y + "' stroke='var(--border)'/>";
    g += "<text x='" + (PL - 5) + "' y='" + (y + 3) + "' text-anchor='end' font-size='10' fill='var(--muted)'>" + v + "</text>";
  });
  vals.forEach(function (v, i) {
    const h = Math.max(2, v / 25 * ih), x = PL + step * i + (step - bw) / 2, y = PT + ih - h;
    const col = v >= 10 ? "var(--pass)" : "var(--error)";
    g += "<rect x='" + x + "' y='" + y + "' width='" + bw + "' height='" + h + "' rx='3' fill='" + col + "'><title>" + v + " marks</title></rect>";
    g += "<text x='" + (x + bw / 2) + "' y='" + (y - 4) + "' text-anchor='middle' font-size='10' fill='var(--muted)'>" + v + "</text>";
  });
  g += "<text x='" + (PL + iw / 2) + "' y='" + (H - 2) + "' text-anchor='middle' font-size='10' fill='var(--muted)'>marks per test (25 = full)</text>";
  return "<svg viewBox='0 0 " + W + " " + H + "' style='width:100%;height:auto;display:block'>" + g + "</svg>";
}

/* ===================================================================== */
export function mount(container) {
  registerRevisionSyncHook();
  let stage = null, stageActive = false, view = "main";
  let range = "all";

  function killStage() {
    if (stage) { try { stage.destroy(); } catch (e) {} stage = null; }
    stageActive = false;
  }

  /* ---------------- main view ---------------- */
  function renderMain(scrollRev) {
    killStage();
    view = "main";
    const hist = loadHist();
    const stats = dashboardStats(FLAT_TEXTS.length);
    let html = '<section class="arena-head"><h1>Progress</h1>' +
      "<p>Your history, trends and weak-word revision — everything synced to your account when you are signed in.</p></section>";

    html += '<section class="stat-strip">' +
      '<div class="stat-cell"><span class="sv">' + stats.tests + '</span><span class="sl">Tests taken</span></div>' +
      '<div class="stat-cell"><span class="sv">' + (stats.bestNet == null ? "—" : stats.bestNet + " WPM") + '</span><span class="sl">Best net</span></div>' +
      '<div class="stat-cell"><span class="sv">' + (stats.avgAcc == null ? "—" : (+stats.avgAcc).toFixed(1) + "%") + '</span><span class="sl">Average accuracy</span></div>' +
      '<div class="stat-cell"><span class="sv">' + stats.drillsPassed + " / " + stats.totalTexts + '</span><span class="sl">Drills passed · 98% gate</span></div>' +
      "</section>";

    /* ---- history ---- */
    html += '<div class="card"><h2>' + icon("chart") + " History</h2>";
    if (!hist.length) {
      html += '<p class="muted" style="margin:0">No tests yet — finish a typing test and it will appear here.</p>';
    } else {
      html += "<div id='historyWrap'><table class='hist'><thead><tr><th>Date</th><th>Text</th><th>Dur.</th><th>Gross</th><th>Net WPM</th><th>Accuracy</th><th>Errors</th><th>Marks</th></tr></thead><tbody>";
      hist.slice(0, 20).forEach(function (x) {
        html += "<tr data-cid='" + (x.clientId || "") + "'><td>" + escapeHtml(x.d || "") + "</td><td>" + escapeHtml(x.name || "") + "</td><td>" + x.min + " min</td><td>" + x.gross + "</td><td><strong>" + x.net + "</strong></td><td>" + (+x.acc).toFixed(1) + "%</td><td>" + x.errs + "</td><td>" + (x.net >= 30 ? x.marks + " / 25" : "DQ") + "</td></tr>";
      });
      html += "</tbody></table></div>" +
        '<div style="margin-top:12px"><button class="btn secondary" id="clearHistory" type="button">Clear my history</button></div>';
    }
    html += "</div>";

    /* ---- trends ---- */
    html += '<div class="card trends-card"><h2>' + icon("chart") + " Trends</h2>" +
      '<div class="controls">' +
        [["all", "All time"], ["7", "Last 7 days"], ["30", "Last 30 days"]].map(function (r) {
          return '<button class="pill trendRange' + (range === r[0] ? " active" : "") + '" type="button" data-range="' + r[0] + '">' + r[1] + "</button>";
        }).join("") +
      "</div>" +
      '<p class="muted" id="trendEmpty">Finish a test and your trends will appear here — net speed, accuracy, marks, your biggest error leak and what to practise next.</p>' +
      '<div id="trendBody">' +
        '<section class="stat-strip trends-tiles">' +
          '<div class="stat-cell"><span class="sv" id="tTotal">0</span><span class="sl">Total tests</span></div>' +
          '<div class="stat-cell"><span class="sv" id="tTime">0 min</span><span class="sl">Time practised</span></div>' +
          '<div class="stat-cell"><span class="sv" id="tBest">0 WPM</span><span class="sl">Best net</span></div>' +
          '<div class="stat-cell"><span class="sv" id="tAvgNet">0 WPM</span><span class="sl">Average net</span></div>' +
          '<div class="stat-cell"><span class="sv" id="tAvg10">0 WPM</span><span class="sl">Avg net · last 10</span></div>' +
          '<div class="stat-cell"><span class="sv" id="tAcc">0%</span><span class="sl">Average accuracy</span></div>' +
          '<div class="stat-cell"><span class="sv" id="tWeek">0</span><span class="sl">Tests this week</span></div>' +
          '<div class="stat-cell"><span class="sv" id="tStreak">0 days</span><span class="sl">Streak</span></div>' +
        "</section>" +
        '<p id="tGoal" style="margin:0 0 6px"></p>' +
        '<div class="chartBox"><h3>Net WPM over time</h3><p class="small" style="margin:0 0 6px">Dashed line = 50 net WPM goal (full 25 marks)</p><div id="chartNet"></div></div>' +
        '<div class="chartBox"><h3>Accuracy over time</h3><div id="chartAcc"></div></div>' +
        '<div class="chartBox"><h3>Marks per test</h3><div id="chartMarks"></div></div>' +
        '<div class="chartBox"><h3>Where errors come from</h3><div id="chartErrors"></div></div>' +
        '<p id="tWeak" class="small"></p>' +
        '<p id="tInsight" style="margin:0"></p>' +
      "</div></div>";

    /* ---- revision ---- */
    html += '<section class="rev-section"><h2 class="rev-h">' + icon("repeat") + " Revision — weak words</h2>" +
      '<p class="sub" style="margin:0 0 10px">Words from your scored mistakes, on a 1 → 3 → 7 → 16-day ladder. Clear a word three times in a session to push it forward.</p>' +
      '<div id="revBody"></div></section>';

    container.innerHTML = html;

    const clearBtn = container.querySelector("#clearHistory");
    if (clearBtn) clearBtn.addEventListener("click", function () {
      clearAllProgress();
      try { cloud.clearBests(); } catch (e) {}
      renderMain(false);
    });
    container.querySelectorAll("#historyWrap tr[data-cid]").forEach(function (tr) {
      tr.addEventListener("click", function () { openStored(tr.getAttribute("data-cid")); });
    });
    container.querySelectorAll(".trendRange").forEach(function (b) {
      b.addEventListener("click", function () { range = b.getAttribute("data-range"); renderMain(false); });
    });
    renderTrends();
    const revBody = container.querySelector("#revBody");
    if (revBody) renderRevisionInto(revBody, {
      onStartSession: startSession,
      rerender: function () { renderMain(true); }
    });
    if (scrollRev) {
      const sec = container.querySelector(".rev-section");
      if (sec && sec.scrollIntoView) sec.scrollIntoView();
    }
  }

  function renderTrends() {
    const fh = filteredHist(range, loadHist());
    const empty = container.querySelector("#trendEmpty"), body = container.querySelector("#trendBody");
    if (!empty || !body) return;
    if (!fh.length) { empty.style.display = ""; body.style.display = "none"; return; }
    empty.style.display = "none"; body.style.display = "";
    const s = trendsSummary();
    if (!s) { empty.style.display = ""; body.style.display = "none"; return; }
    const put = function (id, v) { const el = container.querySelector("#" + id); if (el) el.textContent = v; };
    put("tTotal", fh.length);
    let totalMin = 0;
    fh.forEach(function (x) { totalMin += x.min || 0; });
    put("tTime", totalMin + " min");
    let best = 0;
    fh.forEach(function (x) { if (x.net > best) best = x.net; });
    put("tBest", best + " WPM");
    put("tAvgNet", Math.round(s.avgNet) + " WPM");
    put("tAvg10", Math.round(s.avgNetLast10) + " WPM");
    put("tAcc", (+s.avgAcc).toFixed(1) + "%");
    put("tWeek", s.thisWeek);
    put("tStreak", s.streak + (s.streak === 1 ? " day" : " days"));
    const goal = container.querySelector("#tGoal");
    if (goal) {
      goal.innerHTML = best > 50
        ? "🏆 <strong>Goal reached</strong> — best net " + best + " WPM is in the full-marks band. Now hold it with daily warm-ups."
        : "🎯 <strong>Progress to full marks:</strong> best net " + best + " WPM · <strong>" + (51 - best) + " WPM</strong> short of the 51+ band (25/25 marks).";
    }
    const netVals = fh.map(function (x) { return x.net; });
    const accVals = fh.map(function (x) { return x.acc; });
    const markVals = fh.map(function (x) { return x.marks; });
    const cn = container.querySelector("#chartNet"); if (cn) cn.innerHTML = lineChartSVG(netVals, "var(--accent)", "net WPM", 50);
    const ca = container.querySelector("#chartAcc"); if (ca) ca.innerHTML = lineChartSVG(accVals, "var(--pass)", "accuracy %", 98, 100, true);
    const cm = container.querySelector("#chartMarks"); if (cm) cm.innerHTML = barsSVG(markVals);
    /* error categories */
    const cats = [["spacing", "Spacing"], ["punct", "Punctuation"], ["capital", "Capitalisation"], ["spelling", "Spelling / wrong word"], ["other", "Other"]];
    const tot = { spacing: 0, punct: 0, capital: 0, spelling: 0, other: 0 };
    fh.forEach(function (x) {
      if (x.errCat) { cats.forEach(function (c) { tot[c[0]] += x.errCat[c[0]] || 0; }); }
      else tot.spelling += x.errs || 0;
    });
    const totAll = cats.reduce(function (a, c) { return a + tot[c[0]]; }, 0);
    const ce = container.querySelector("#chartErrors");
    if (ce) {
      ce.innerHTML = totAll === 0
        ? "<p class='small' style='margin:0'>No errors recorded in this range — clean typing. 🎉</p>"
        : cats.map(function (c) {
            const v = tot[c[0]], pct = Math.round(v / totAll * 100);
            return "<div class='errRow'><span>" + c[1] + "</span><span class='errBar'><i style='width:" + pct + "%'></i></span><strong>" + v + " (" + pct + "%)</strong></div>";
          }).join("");
    }
    /* weakest keys / words */
    const wk = {}, ww = {};
    fh.forEach(function (x) {
      if (x.weakKeys) Object.keys(x.weakKeys).forEach(function (k) { wk[k] = (wk[k] || 0) + x.weakKeys[k]; });
      if (x.weakWords) Object.keys(x.weakWords).forEach(function (k) { ww[k] = (ww[k] || 0) + x.weakWords[k]; });
    });
    const topKeys = Object.keys(wk).sort(function (a, b) { return wk[b] - wk[a]; }).slice(0, 8);
    const topWords = Object.keys(ww).sort(function (a, b) { return ww[b] - ww[a]; }).slice(0, 8);
    const tw = container.querySelector("#tWeak");
    if (tw) {
      if (!topKeys.length && !topWords.length) tw.textContent = "";
      else tw.innerHTML =
        (topKeys.length ? "⌨️ <strong>Weakest keys:</strong> " + topKeys.map(function (k) { return "“" + (k === " " ? "Space" : k) + "” ×" + wk[k]; }).join(" · ") + "<br>" : "") +
        (topWords.length ? "📝 <strong>Most-missed words:</strong> " + topWords.map(function (k) { return "“" + k + "” ×" + ww[k]; }).join(" · ") : "");
    }
    /* insight */
    const ti = container.querySelector("#tInsight");
    if (ti) {
      let txt = "";
      if (fh.length >= 4) {
        const half = Math.floor(fh.length / 2);
        const avg = function (arr) { return arr.reduce(function (a, x) { return a + x.net; }, 0) / arr.length; };
        const d = avg(fh.slice(half)) - avg(fh.slice(0, half));
        txt += d > 0.5 ? "📈 Your net speed is <strong>climbing</strong> — recent tests average " + Math.abs(d).toFixed(1) + " WPM higher than your earlier ones. "
          : d < -0.5 ? "📉 Recent tests average " + Math.abs(d).toFixed(1) + " WPM <strong>lower</strong> than your earlier ones — fatigue or harder passages? A 15-minute warm-up before tests usually fixes it. "
          : "➡️ Your speed is <strong>steady</strong> across this range. ";
      }
      if (totAll > 0) {
        const big = cats.slice().sort(function (a, b) { return tot[b[0]] - tot[a[0]]; })[0];
        const drillMap = { spacing: "Part 5 → Spacing Traps", punct: "Part 5 → Punctuation, Numbers, Dates", capital: "Part 2 → Opposite-Hand Shift drill", spelling: "Part 1 row drills + Part 3 n-gram chunks", other: "Part 6 sentences at the 98% gate" };
        txt += "🔍 Biggest leak: <strong>" + big[1].toLowerCase() + "</strong> (" + Math.round(tot[big[0]] / totAll * 100) + "% of all errors). Fix it in Skill Drills → " + drillMap[big[0]] + ".";
      }
      ti.innerHTML = txt;
    }
  }

  /* ---------------- stored result ---------------- */
  function openStored(cid) {
    const en = loadHist().find(function (x) { return x.clientId === cid; });
    if (!en) return;
    killStage();
    view = "stored";
    container.innerHTML = '<div id="storedWrap"></div>';
    const wrap = container.querySelector("#storedWrap");
    const ex = specOf(en.examId || "hcm") || EXAM_SPECS[0];
    const handlers = {
      onBack: function () { renderMain(false); },
      onProgress: function () { renderMain(false); },
      onPractise: function () {
        const words = mistakeSessionWords(en);
        if (words.length) startSession(words);
        else renderMain(true);
      }
    };
    if (ex.id === "hcm") {
      renderStoredHcmResultInto(wrap, en, Object.assign({}, handlers, {
        onRetake: function () { location.hash = "#/studio"; }
      }));
    } else {
      renderStoredExamResultInto(wrap, en, ex, Object.assign({}, handlers, {
        onRetake: function () { location.hash = "#/hub/" + ex.id; }
      }));
    }
    window.scrollTo(0, 0);
  }

  /* ---------------- revision session stage ---------------- */
  function startSession(words) {
    const only = bankWordsOnly(words);
    const session = beginStreamSession(only);
    if (!session) { renderMain(true); return; }
    killStage();
    view = "stage";
    stageActive = true;
    container.innerHTML = '<div id="progStage" class="practiceStage"></div>';
    const slot = container.querySelector("#progStage");
    let streamDone = false;
    stage = mountPracticeStage(slot, {
      silo: { key: "revision", items: [{ id: "revisionStream", name: "Revision session", text: session.text, isDrill: true }], index: 0 },
      durMin: 2, mode: "custom", title: "Revision session",
      onExit: function () { cancelStreamSession(); killStage(); renderMain(true); },
      onRevisionStreamResult: function () { streamDone = true; },
      onFinish: function () {
        if (streamDone && stage) {
          streamDone = false;
          const S = stage._state;
          revStreamApply(S.target, S.typed.map(function (x) { return x.ch; }).join(""));
        }
        killStage();
        renderMain(true);
      }
    });
    if (stage && stage.focus) stage.focus();
    window.scrollTo(0, 0);
  }

  /* ---------------- boot ---------------- */
  /* "Practise My Mistakes" from an Arena result lands here with the
     entry's clientId pending — start its revision session at once. */
  const pendingId = consumePendingMistakeEntry();
  let started = false;
  if (pendingId) {
    const en = loadHist().find(function (x) { return x.clientId === pendingId; });
    if (en) {
      const words = mistakeSessionWords(en);
      if (words.length) { startSession(words); started = true; }
    }
  }
  if (!started) renderMain(false);

  const unsubs = [
    on("data", function () { if (view === "main" && !stageActive) renderMain(false); }),
    on("auth", function () { if (view === "main" && !stageActive) renderMain(false); }),
    on("revision", function () { if (view === "main" && !stageActive) renderMain(false); })
  ];
  return {
    destroy: function () {
      unsubs.forEach(function (u) { try { u(); } catch (e) {} });
      killStage();
    }
  };
}
