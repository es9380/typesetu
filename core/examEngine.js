/* core/examEngine.js — the typing stages (Stage 2).
   Two mounts, both behaviour-identical ports of the current live engines:
     mountHcmStage  — the main screen engine (core.js): HCM hub mocks,
                      HCM Custom Tests, and (Stage 3) practice contexts
                      on the same code path.
     mountExamStage — the exam engine (exams.js): CHSL / CGL (E1) and
                      RRB (E2), hub mocks + custom mocks.
   Scoring comes from core/scoringMatrix.js (verbatim math); telemetry
   from core/telemetry.js; finish side effects (history, bests, revision
   bank, cloud via the Stage 1 bridge) match the old finish paths exactly.
   Input handling is direct-DOM: the capture textarea's own input event
   drives a span-class update — no framework re-render per keystroke. */

import {
  SETTINGS, persistSettings, loadHist, saveHist, loadDone, saveDone,
  pushBest, lessonStatus, loadBest, sortBestArr, newClientId
} from "./storage.js";
import {
  hcmMarksFor, hcmBandLabel, fmtTime, wordCountOf, alignWordsHcm,
  displayFlagsHcm, classifyChar, classifyPair, scoreWords, hcmWordTokens
} from "./scoringMatrix.js";
import { fmtNum, dispErrPct } from "../data/exams.js";
import { TEL, buildHcmTelemetry, buildExamTelemetry } from "./telemetry.js";
import { forensicsHtml, revFeed } from "./forensics.js";
import { cloud } from "../services/cloudBridge.js";
import { soundOn, setSound, keyClick } from "../services/soundEngine.js";
import { appState } from "./state.js";
import { renderCommandBar } from "../components/FloatingCommandBar.js";
import { openPassageModal } from "../components/PassageModal.js";
import { showMotivation } from "../components/MotivationOverlay.js";
import { fingerKeyboardHtml } from "../components/FingerKeyboard.js";
import { celebrateIfBest } from "../components/celebrate.js";
import { escapeHtml } from "../components/ProfilePopover.js";
import { icon } from "../components/icons.js";
import { downloadFile } from "../services/backup.js";
import {
  hcmResultSkeleton, animateRings, cmpComparisonHtml,
  renderExamResultInto, openResultCard
} from "../features/examArena/resultView.js";

export const ENGINE_STAGE = 2;
export function engineReady() { return true; }

/* ============================ shared bits ============================ */

function printPassage(name, text) {
  let pa = document.getElementById("printArea");
  if (!pa) { pa = document.createElement("div"); pa.id = "printArea"; document.body.appendChild(pa); }
  pa.innerHTML = "<h2>" + escapeHtml(name || "Passage") + "</h2><p>" + escapeHtml(text || "") + "</p>";
  document.body.classList.add("printing-passage");
  try { window.print(); } catch (e) {}
  setTimeout(function () { document.body.classList.remove("printing-passage"); }, 300);
}

/* Text size (v16 as Paper View's own pills; v21 hoisted to module level
   and moved into the shared command bar): ONE 4-step control on the
   stage toolbar, visible in every stage context, scaling ALL typing
   surfaces together — the screen-view passage (#typeText), the paper
   sheet and the paper typed box (HCM stage), the passage + typed
   display (EX stage). The choice persists under the EXISTING key
   ts_paper_font_v1 (step index 0–3) so a size chosen before v21
   carries over untouched; the default step (1 → 19px) matches the
   size the surfaces have always rendered at. All surfaces use
   unitless line-heights, so line height scales proportionally and
   the scroll-follow maths (which measures line height from the DOM)
   keeps working at every size. */
const PAPER_FONT_KEY = "ts_paper_font_v1";
const PAPER_FONT_SIZES = [17, 19, 21, 23];
function paperFontStep() {
  let n = NaN;
  try { n = parseInt(localStorage.getItem(PAPER_FONT_KEY), 10); } catch (e) {}
  return (n >= 0 && n < PAPER_FONT_SIZES.length) ? n : 1;
}
function setPaperFontStep(n) {
  try { localStorage.setItem(PAPER_FONT_KEY, String(n)); } catch (e) {}
}

/* askConfirm — verbatim port of the current exams.js confirm modal. */
function ensureConfirmBox() {
  let box = document.getElementById("confirmBox");
  if (box) return box;
  box = document.createElement("div");
  box.id = "confirmBox";
  box.className = "confirm-box";
  box.innerHTML = '<div class="confirm-card"><h3 id="confirmTitle"></h3><p id="confirmText"></p>' +
    '<div class="confirm-actions"><button class="btn secondary" type="button" id="confirmNo">Keep typing</button>' +
    '<button class="btn" type="button" id="confirmYes">Yes, submit</button></div></div>';
  document.body.appendChild(box);
  return box;
}
function askConfirm(title, text, onYes, onNo) {
  ensureConfirmBox();
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmText").textContent = text;
  const box = document.getElementById("confirmBox"); box.classList.add("open");
  const yes = document.getElementById("confirmYes"), no = document.getElementById("confirmNo");
  const newYes = yes.cloneNode(true), newNo = no.cloneNode(true);
  yes.parentNode.replaceChild(newYes, yes); no.parentNode.replaceChild(newNo, no);
  newYes.addEventListener("click", function () { box.classList.remove("open"); onYes(); });
  newNo.addEventListener("click", function () { box.classList.remove("open"); if (onNo) onNo(); });
}

/* Zen Focus Mode v2.
   - enter(): arms Zen for the running test and hides the chrome.
   - Every real keystroke while armed re-hides the chrome, so Zen works again
     after the mouse revealed it (v1 only ever entered once, at timer start).
   - Only DELIBERATE mouse movement (>= 36px travelled) reveals the chrome;
     tiny jitters and layout-scroll mousemove events are ignored.
   - Esc reveals the chrome; the next keystroke hides it again.
   - exit(): disarms completely (test finished / view destroyed). */
function makeZen() {
  let armed = false, shown = false, travelled = 0, lastX = null, lastY = null;
  const IGNORE = { Shift: 1, Control: 1, Alt: 1, Meta: 1, CapsLock: 1, Tab: 1, Escape: 1 };
  function hide() { if (!shown) return; shown = false; document.body.classList.add("zen"); }
  function reveal() { if (shown) return; shown = true; travelled = 0; document.body.classList.remove("zen"); }
  function enter() { armed = true; shown = true; hide(); }
  function exit() { armed = false; shown = true; travelled = 0; lastX = lastY = null; document.body.classList.remove("zen"); }
  function onKey(e) {
    if (!armed) return;
    if (e.key === "Escape") { reveal(); return; }
    if (IGNORE[e.key] || e.ctrlKey || e.metaKey || e.altKey) return;
    travelled = 0; lastX = lastY = null;
    hide();
  }
  function onMove(e) {
    if (!armed || shown) return;
    if (lastX == null) { lastX = e.clientX; lastY = e.clientY; return; }
    travelled += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
    if (travelled >= 36) reveal();
  }
  document.addEventListener("keydown", onKey, true);
  return {
    enter: enter, exit: exit,
    watchMouse: function (el) { el.addEventListener("mousemove", onMove); },
    destroy: function () { document.removeEventListener("keydown", onKey, true); exit(); }
  };
}

/* ---------- sticky timer pill (v23) ----------
   Exam stages (official mocks + custom tests, both engines) show ONE
   mid-test display: the time left, in a pill pinned near the top of
   the viewport. Net WPM / predicted marks / accuracy are result-screen
   numbers now — they are no longer painted during the test (they are
   still computed exactly as before, at submit). The pill is painted
   from the same remaining-time value the old HUD strip used — each
   stage's own interval tick — never from a second clock. It lives on
   document.body so no stage ancestor can disturb its fixed position,
   and Zen never dims it (Zen only fades the header, footer, command
   bar and stage-top). pointer-events:none — it can never eat a click.
   Placement: the site header is itself fixed and 58px tall, so the
   pill pins immediately beneath it (header + 8px) rather than on top
   of the brand/tabs — the same always-visible top spot in every
   state, Zen or not, with nothing ever hidden behind it. */
function makeTimerPill() {
  const el = document.createElement("div");
  el.className = "timer-pill";
  el.setAttribute("role", "timer");
  el.setAttribute("aria-label", "Time left");
  el.innerHTML = '<span class="tp-label">Time left</span><span class="tp-time">0:00</span><span class="tp-track"><i></i></span>';
  el.hidden = true;
  document.body.appendChild(el);
  const timeEl = el.querySelector(".tp-time");
  const fillEl = el.querySelector(".tp-track i");
  return {
    el: el,
    /* left/total in seconds (floats ok — fmtTime clamps + ceils, the
       same value the old HUD time cell received). The track DRAINS:
       full width at entry, empty at 0:00. Final 60s: danger colour,
       no blinking. */
    paint: function (left, total) {
      timeEl.textContent = fmtTime(left);
      fillEl.style.width = (total > 0 ? Math.max(0, Math.min(100, left / total * 100)) : 0) + "%";
      el.classList.toggle("danger", left <= 60);
      el.hidden = false;
    },
    hide: function () { el.hidden = true; },
    destroy: function () { if (el.parentNode) el.parentNode.removeChild(el); }
  };
}

/* ⚙ More popover — Finger Keyboard, Sound, Download/Print passage.
   NO auto-submit option anywhere (sid's standing rule).
   Close paths: the ✕ button, any click outside the popover (the More
   button itself is left to the command bar's toggle), and Esc. */
function morePopHtml() {
  return '<div class="more-pop" hidden>' +
    '<div class="more-head"><span>More options</span><button type="button" class="more-x" data-more="close" aria-label="Close">✕</button></div>' +
    '<button type="button" data-more="kb">' + icon("keyboard") + '<span>Finger Keyboard</span><span class="more-state" data-ms="kb"></span></button>' +
    '<button type="button" data-more="sound">' + icon("eye") + '<span>Sound</span><span class="more-state" data-ms="sound"></span></button>' +
    '<button type="button" data-more="download">' + icon("download") + '<span>Download passage</span></button>' +
    '<button type="button" data-more="print">' + icon("printer") + '<span>Print passage</span></button>' +
  '</div>';
}
function wireMorePop(pop, kbSection, getPassage) {
  function paint() {
    const kb = pop.querySelector('[data-ms="kb"]'); if (kb) kb.textContent = SETTINGS.kb ? "On" : "Off";
    const sn = pop.querySelector('[data-ms="sound"]'); if (sn) sn.textContent = soundOn() ? "On" : "Off";
  }
  function close() { pop.hidden = true; }
  function onDocClick(e) {
    if (pop.hidden) return;
    if (pop.contains(e.target)) return;
    if (e.target.closest && e.target.closest('[data-act="more"]')) return;
    close();
  }
  function onDocKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onDocKey);
  paint();
  pop.addEventListener("click", function (e) {
    const b = e.target.closest("[data-more]"); if (!b) return;
    const act = b.getAttribute("data-more");
    if (act === "close") { close(); return; }
    if (act === "kb") {
      SETTINGS.kb = !SETTINGS.kb; persistSettings();
      if (kbSection) { kbSection.style.display = SETTINGS.kb ? "block" : "none"; if (SETTINGS.kb && !kbSection.dataset.built) { kbSection.querySelector("#keyboard").innerHTML = fingerKeyboardHtml(); kbSection.dataset.built = "1"; } }
    } else if (act === "sound") { setSound(!soundOn()); }
    else if (act === "download") { const p = getPassage(); downloadFile("hcm-passage.txt", p.name + "\nDelhi Police HCM — paper-to-screen practice passage\n\n" + p.text, "text/plain"); }
    else if (act === "print") { const p2 = getPassage(); printPassage(p2.name, p2.text); }
    paint();
  });
  return {
    paint: paint,
    close: close,
    destroy: function () {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onDocKey);
    }
  };
}

/* =====================================================================
   HCM STAGE — verbatim port of the current core.js main engine.
   opts: { silo:{key,items:[{id,name,text,isDrill,diff,topic}],index,capSec},
           ctx:"exam"|"practice", durMin, paperView, mode:"official"|"custom",
           examLabel, onExit(), onFinish(entry), onPractiseMistakes(entry),
           onExamSwitch(examId), onMistakeDrillResult(mres,s), onRevisionStreamResult() } */
export function mountHcmStage(container, opts) {
  opts = opts || {};
  const S = {
    target: "", base: "", typed: [], caret: 0, started: false, startT: 0,
    durMin: opts.durMin || 5, timer: null, finished: false,
    errCat: { spelling: 0, capital: 0, punct: 0, spacing: 0, other: 0 }, errKeys: {}, errWords: {},
    currentId: "", currentName: "", isDrill: false,
    paperView: !!opts.paperView, bsCount: 0, lastMistakes: [],
    ctx: opts.ctx === "exam" ? "exam" : "practice",
    silo: opts.silo || null, capSec: (opts.silo && opts.silo.capSec) || 0,
    bsAllowed: true
  };
  let paperHold = false, paperProgScroll = false;
  let lastPaperInputAt = 0; /* v19: timestamp of the last capture input (see the typeBox scroll guard below) */
  let bsUser = null; /* session-only backspace override for Official mocks (v16) */
  let spanCache = [], spanText = [];
  const zen = makeZen();

  container.innerHTML =
    '<div class="stage-wrap' + (isExamCtx() ? " exam-live" : "") + '" id="hcmStage">' +
      '<div class="stage-top">' +
        '<button class="pill" type="button" id="stBack">← Back</button>' +
        '<span class="stage-title" id="stTitle"></span>' +
        '<span style="flex:1"></span>' +
      '</div>' +
      '<div class="stage-bar" id="stBar"></div>' +
      morePopHtml() +
      '<div class="exam-menu-pop" id="stExamMenu" hidden></div>' +
      /* v23: exam mounts render NO HUD strip and NO progress bar —
         the sticky timer pill (created below, exam mounts only) is
         the only mid-test display, and the type area aligns directly
         under the command bar. The strip carried no controls (every
         control lives in the command bar), so nothing is re-homed.
         Practice mounts keep the strip + bar exactly as before. */
      (isExamCtx() ? "" :
      '<div class="hud" id="stHud">' +
        '<div class="hud-cell"><span class="hud-v" id="sTime">0:00</span><span class="hud-l" id="sTimeLabel">Time left</span></div>' +
        '<div class="hud-cell hud-net"><span class="hud-v" id="sNet">0</span><span class="hud-l">Net WPM</span></div>' +
        '<div class="hud-cell hud-marks"><span class="hud-v" id="sMarks">—</span><span class="hud-l">Predicted marks</span></div>' +
      '</div>' +
      '<div class="prog"><i id="progBar"></i></div>') +
      '<p class="size-line small" id="sizeLine"></p>' +
      '<div class="type-area" id="typeArea">' +
      '<div class="paper-wrap" id="paperWrap" style="display:none">' +
        '<div class="paper-head"><span class="paper-title">Paper View</span>' +
          '<span class="paper-tools">' +
            '<button class="pill" type="button" id="paperPrint" aria-label="Print passage">' + icon("printer") + '</button>' +
          '</span></div>' +
        '<div class="paperSheet" id="paperSheet"><div id="paperSheetText"></div></div>' +
      '</div>' +
      '<div class="typeBox" id="typeBox"><div class="typeText" id="typeText"></div><div class="caretEl" id="caretEl"></div><div class="paperTyped" id="paperTyped"></div>' +
        '<textarea id="capture" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Type here"></textarea>' +
      '</div>' +
      '</div>' +
      '<p class="modeHint small" id="modeHint"></p>' +
      '<div class="stage-actions">' +
        '<button class="btn" type="button" id="submitBtn" style="display:none">Submit</button>' +
        '<button class="btn secondary" type="button" id="restartBtn">Restart</button>' +
      '</div>' +
      '<div class="kbSection" id="kbSection" style="display:none"><h3>Finger keyboard — which finger presses which key</h3><div id="keyboard"></div></div>' +
      '<div id="resultSlot">' + hcmResultSkeleton() + '</div>' +
      '<div class="lhist" id="lessonHistory" aria-live="polite"></div>' +
    '</div>';

  const q = function (sel) { return container.querySelector(sel); };
  const capture = q("#capture"), typeBox = q("#typeBox"), typeText = q("#typeText");
  const morePop = q(".more-pop");
  const kbSection = q("#kbSection");
  const more = wireMorePop(morePop, kbSection, function () { return { name: S.currentName, text: S.target }; });
  if (SETTINGS.kb) { kbSection.style.display = "block"; kbSection.querySelector("#keyboard").innerHTML = fingerKeyboardHtml(); kbSection.dataset.built = "1"; }
  zen.watchMouse(container);
  /* v23: the sticky timer pill exists only on exam mounts (official
     mocks + custom tests). Practice mounts never create one. */
  const pill = isExamCtx() ? makeTimerPill() : null;
  function paintPill(left, total) { if (pill) pill.paint(left, total); }

  function isExamCtx() { return S.ctx === "exam"; }
  function highlightOn() {
    if (typeof SETTINGS.highlight === "boolean") return SETTINGS.highlight;
    if (S.paperView) return false;
    return true;
  }
  /* Backspace rule: Custom Tests keep their free S.bsAllowed toggle.
     Official HCM mocks default to the exam rule (allowed) and the
     command-bar toggle flips the session-only bsUser override — the same
     mechanism the exam stage uses; resetTest() restores the default.
     Practice mounts (Studio) keep the toggle locked, exactly as before.
     Every input guard reads bsEffective() live. */
  function bsLocked() { return opts.mode !== "custom" && opts.mode !== "official"; }
  function bsEffective() {
    if (opts.mode === "custom") return S.bsAllowed;
    if (opts.mode === "official") return bsUser != null ? bsUser : true;
    return true;
  }

  /* ---------- command bar ---------- */
  function paintBar() {
    const slot = q("#stBar"); if (!slot) return;
    slot.innerHTML = "";
    const bar = renderCommandBar({
      examLabel: opts.examLabel || "Delhi Police HCM",
      duration: S.durMin,
      backspace: bsEffective(),
      backspaceLocked: bsLocked(),
      liveErrors: highlightOn(),
      paperView: S.paperView,
      fontStep: paperFontStep(),
      onAction: onBarAction
    });
    slot.appendChild(bar);
  }
  function onBarAction(name, value) {
    if (name === "exam") {
      const menu = q("#stExamMenu");
      if (!menu.hidden) { menu.hidden = true; return; }
      menu.innerHTML = ["hcm", "chsl", "cgl", "rrb"].map(function (id) {
        return '<button type="button" class="pill" data-sw="' + id + '">' + escapeHtml(({ hcm: "Delhi Police HCM", chsl: "SSC CHSL", cgl: "SSC CGL DEST", rrb: "RRB NTPC" })[id]) + '</button>';
      }).join("");
      menu.hidden = false;
      menu.querySelectorAll("[data-sw]").forEach(function (b) {
        b.addEventListener("click", function () { menu.hidden = true; if (typeof opts.onExamSwitch === "function") opts.onExamSwitch(b.getAttribute("data-sw")); });
      });
    }
    else if (name === "duration") { setDuration(+value); paintBar(); focusCapture(); }
    else if (name === "passage") { openPicker(); }
    else if (name === "paper") { setPaperView(!S.paperView); paintBar(); focusCapture(); }
    else if (name === "backspace") {
      if (opts.mode === "custom") { S.bsAllowed = !S.bsAllowed; paintBar(); focusCapture(); }
      else if (opts.mode === "official") { bsUser = !bsEffective(); paintBar(); focusCapture(); }
    }
    else if (name === "errors") { SETTINGS.highlight = !highlightOn(); persistSettings(); renderText(); paintBar(); focusCapture(); }
    else if (name === "pfont") {
      /* v21: text size from the stage toolbar — persist under the
         existing key, apply to all surfaces, repaint the bar's active
         pill, and re-render so the follow functions re-run at the new
         line height and the caret line lands back in view. Typed text
         and caret are untouched (the size is presentation-only). */
      setPaperFontStep(+value); applyPaperFont(); paintBar(); renderText(); focusCapture();
    }
    else if (name === "more") { morePop.hidden = !morePop.hidden; more.paint(); }
  }
  function openPicker() {
    const s = S.silo; if (!s || !s.items) return;
    const groupsMap = {}, order = [];
    s.items.forEach(function (it) {
      const g = it.diff ? (it.diff === "easy" ? "Easy" : it.diff === "medium" ? "Moderate" : "Hard") : "Passages";
      if (!groupsMap[g]) { groupsMap[g] = []; order.push(g); }
      groupsMap[g].push({ id: it.id, name: it.name, sub: (it.topic ? it.topic + " · " : "") + wordCountOf(it.text) + " words", diff: it.diff || null, done: lessonStatus(it.id).completed });
    });
    openPassageModal({
      title: "Choose a passage",
      groups: order.map(function (g) { return { label: g, items: groupsMap[g] }; }),
      onPick: function (item) {
        let idx = -1; s.items.forEach(function (it, i) { if (it.id === item.id) idx = i; });
        if (idx >= 0) { loadSiloIndex(idx); focusCapture(); }
      }
    });
  }

  /* ---------- target / load / reset (verbatim ports) ---------- */
  function buildTarget(base) {
    const t = base || "";
    if (!isExamCtx()) return t;
    if (S.currentId === "sim10") return t;
    const need = S.durMin * 50;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length <= need) return t;
    let cut = words.slice(0, need);
    let endIdx = -1;
    for (let i = cut.length - 1; i >= Math.max(0, cut.length - 15); i--) { if (/[.!?]["')\]]?$/.test(cut[i])) { endIdx = i; break; } }
    if (endIdx >= Math.floor(need * 0.6)) cut = cut.slice(0, endIdx + 1);
    return cut.join(" ");
  }
  function updateSizeLine() {
    const sl = q("#sizeLine"); if (!sl) return;
    const shown = wordCountOf(S.target);
    if (!isExamCtx()) {
      sl.textContent = "Loaded: " + (S.currentName || "") + " · " + shown + " words · practice" + (S.capSec ? " · up to " + Math.round(S.capSec / 60) + " min" : "");
    } else if (S.currentId === "sim10") {
      sl.textContent = "Loaded: " + (S.currentName || "Exam passage") + " · " + shown + " words · 10 min";
    } else {
      sl.textContent = "Loaded: " + (S.currentName || "") + " · " + shown + " words · " + S.durMin + " min";
    }
  }
  function loadText(id, name, base, isDrill) {
    S.currentId = id; S.currentName = name; S.isDrill = !!isDrill;
    S.base = base; resetTest();
    updateLessonHistory();
  }
  function loadSiloIndex(i) {
    const s = S.silo; if (!s || !s.items || !s.items[i]) return;
    s.index = i; const it = s.items[i];
    loadText(it.id, it.name, it.text, it.isDrill);
  }
  function resetTest() {
    clearInterval(S.timer);
    S.target = buildTarget(S.base || "");
    S.typed = []; S.caret = 0; S.started = false; S.finished = false;
    S.errCat = { spelling: 0, capital: 0, punct: 0, spacing: 0, other: 0 }; S.errKeys = {}; S.errWords = {};
    S.bsCount = 0; S.lastMistakes = [];
    if (bsUser != null) { bsUser = null; paintBar(); } /* (re)starting a test restores the backspace exam default */
    capture.value = "";
    const rb = q("#resultBox"); if (rb) rb.style.display = "none";
    const prR = q("#pracResult"); if (prR) prR.style.display = "none";
    typeBox.scrollTop = 0;
    renderText(); updateStats(0);
    typeBox.scrollTop = 0;
    if (isExamCtx()) { paintPill(S.durMin * 60, S.durMin * 60); }
    else {
      q("#sTime").textContent = fmtTime(0);
      const lbl = q("#sTimeLabel"); if (lbl) lbl.textContent = "Time";
      q("#progBar").style.width = "0%";
    }
    q("#modeHint").textContent = "";
    if (S.paperView) updatePaperSheet();
    if (S.paperView) { paperHold = false; const psh = q("#paperSheet"); if (psh) psh.scrollTop = 0; }
    updateSizeLine();
    paintSubmitBtn();
    updateLessonHistory();
    TEL.setTarget(S.target, "pos");
  }

  /* ---------- rendering (verbatim ports) ---------- */
  function buildSpans() {
    const t = S.target; let html = "";
    for (let i = 0; i < t.length; i++) { html += '<span class="ch">' + escapeHtml(t[i]) + '</span>'; }
    typeText.innerHTML = html;
    spanCache = new Array(t.length);
    spanText = new Array(t.length);
    for (let j = 0; j < t.length; j++) { spanCache[j] = "ch"; spanText[j] = t[j]; }
  }
  function renderText() {
    const t = S.target, pos = S.typed.length;
    const cpos = Math.max(0, Math.min(S.caret || 0, pos));
    const raw = !highlightOn();
    typeText.classList.toggle("raw", raw);
    if (typeText.children.length !== t.length) buildSpans();
    for (let i = 0; i < t.length; i++) {
      let cls = "ch";
      const glyph = i < pos ? S.typed[i].ch : t[i];
      if (spanText[i] !== glyph) { spanText[i] = glyph; typeText.children[i].textContent = glyph; }
      if (i < pos) {
        if (raw) cls += " typed";
        else cls += S.typed[i].ok ? " ok typed" : (glyph === " " ? " bad spaceBad typed" : " bad typed");
      }
      else if (i === pos) { cls += " cur"; }
      if (spanCache[i] !== cls) { spanCache[i] = cls; typeText.children[i].className = cls; }
    }
    if (S.paperView) { renderPaperTyped(); scrollPaperTyped(); }
    else { scrollCursorIntoView(cpos); positionCaret(cpos); }
    syncPaperScroll();
    paintPaperLine();
  }
  function scrollCursorIntoView(pos) {
    const kids = typeText.children, total = kids.length;
    if (!total) return;
    const idx = Math.min(Math.max(pos, 0), total - 1);
    const cur = kids[idx];
    if (!cur) return;
    const savedWinY = window.scrollY, savedWinX = window.scrollX;
    const boxRect = typeBox.getBoundingClientRect();
    let curRect = cur.getBoundingClientRect();
    if ((curRect.height === 0 || curRect.width === 0) && idx > 0) {
      const prevRect = kids[idx - 1].getBoundingClientRect();
      if (prevRect.height > 0) curRect = prevRect;
    }
    let lh = parseFloat(window.getComputedStyle(typeText).lineHeight);
    if (isNaN(lh) || lh <= 0) lh = curRect.height > 0 ? curRect.height : 42;
    const borderTop = typeBox.clientTop || 0;
    const lineTop = curRect.top - boxRect.top + typeBox.scrollTop;
    const lineBottom = lineTop + lh;
    const viewH = typeBox.clientHeight;
    const viewTop = typeBox.scrollTop + borderTop, viewBottom = viewTop + viewH;
    let desired = typeBox.scrollTop;
    if (lineBottom + lh > viewBottom) { desired = lineBottom + lh - borderTop - viewH; }
    if (lineTop - lh < desired + borderTop) { desired = lineTop - lh - borderTop; }
    const maxScroll = Math.max(0, typeBox.scrollHeight - typeBox.clientHeight);
    if (desired > maxScroll) desired = maxScroll;
    if (desired < 0) desired = 0;
    if (desired !== typeBox.scrollTop) typeBox.scrollTop = desired;
    if (window.scrollY !== savedWinY || window.scrollX !== savedWinX) window.scrollTo(savedWinX, savedWinY);
  }
  let caretBlinkKey = "";
  function caretOffsetInBox(node) {
    let x = 0, y = 0, n = node;
    while (n && n !== typeBox) { x += (n.offsetLeft || 0); y += (n.offsetTop || 0); n = n.offsetParent; }
    return { x: x, y: y };
  }
  function positionCaret(pos) {
    const el = q("#caretEl"); if (!el) return;
    const kids = typeText.children, total = kids.length;
    if (!total) { el.classList.remove("on"); return; }
    let lh = parseFloat(window.getComputedStyle(typeText).lineHeight);
    if (isNaN(lh) || lh <= 0) lh = 42;
    let x, y;
    if (pos < total) {
      const span = kids[pos], off = caretOffsetInBox(span);
      if ((span.offsetWidth === 0 || span.offsetHeight === 0) && pos > 0) {
        const prev = kids[pos - 1], poff = caretOffsetInBox(prev);
        x = poff.x + (prev.offsetWidth || 0); y = poff.y;
      } else { x = off.x; y = off.y; }
    } else {
      const last = kids[total - 1], loff = caretOffsetInBox(last);
      x = loff.x + (last.offsetWidth || 0); y = loff.y;
    }
    el.style.left = (x - 1) + "px";
    el.style.top = (y + lh * 0.14) + "px";
    el.style.height = (lh * 0.72) + "px";
    el.classList.add("on");
    const key = pos + "|" + x + "|" + y;
    if (key !== caretBlinkKey) {
      caretBlinkKey = key;
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
    }
  }
  /* ---------- Paper View auto-scroll ----------
     Both Paper View panes are FIXED-height internal scrollers (CSS),
     but they follow different rules. The TYPED BOX keeps the v17/v19
     nearest rule (scrollPaperTyped below): on every render it scrolls
     ONLY when the caret's line has left its comfortable visible zone,
     and then only by the minimum amount — no per-keystroke chasing, no
     snapping the caret to the top. The SHEET follows the pre-redesign
     PROPORTIONAL rule (syncPaperScroll below, restored in v22): its
     scroll position is the typed fraction of the passage times its
     total scrollable distance, so it glides a few px per word and
     never jumps a line. The sheet stays a plain static print (no bold,
     no highlight — v16's "remove tracing all" stands). */
  function paperLineH(el, ratio) {
    let lh = 0, fs = 0;
    try {
      const cs = window.getComputedStyle(el);
      lh = parseFloat(cs.lineHeight) || 0;
      fs = parseFloat(cs.fontSize) || 0;
    } catch (e) {}
    if (!(lh > 0)) lh = (fs > 0 ? fs : 19) * ratio;
    return lh;
  }
  function paperLineTop(el, pane) {
    /* Position of el's first line inside pane's scrollable content,
       measured with getBoundingClientRect — the same technique as the
       proven scrollCursorIntoView. (v17 walked offsetTop/offsetParent;
       the rect form is immune to offsetParent-chain surprises — a
       transformed or repositioned ancestor can never skew it.) */
    const pRect = pane.getBoundingClientRect(), eRect = el.getBoundingClientRect();
    return eRect.top - pRect.top - (pane.clientTop || 0) + pane.scrollTop;
  }
  function syncPaperScroll() {
    /* Sheet: the PRE-REDESIGN proportional rule, restored in v22 (a
       faithful port of the old single-file site's syncPaperScroll).
       The sheet's scroll position is the typed fraction of the passage
       (typed chars / target chars) times the sheet's total scrollable
       distance (scrollHeight − clientHeight). The sheet therefore
       glides a few px per word and NEVER jumps a line; the current
       line drifts slowly down the pane as you type; at 100% the sheet
       sits at max scroll, where its bottom padding leaves the final
       line fully inside the pane, never clipped. (v20's minimal /
       nearest line-step rule — sit still, then jump exactly one line
       in a single frame each time the caret line crossed the pane
       edge — is what the user experienced as blink-jumps that made
       him lose his line; it replaced this rule in the redesign and
       is now reverted.)
       Manual-scroll hold: the sheet's scroll listener (wired with the
       stage's listeners) sets paperHold on any scroll that was NOT
       programmatic — paperProgScroll marks our own sets and is cleared
       on the next animation frame. While paperHold is set, sync leaves
       the sheet exactly where the user put it until the proportional
       target comes back within 48px of it, which clears the hold and
       resumes the glide. The <2px deadband keeps the glide in ~2px
       micro-steps instead of re-setting on every keystroke. */
    if (!S.paperView) return;
    const sh = q("#paperSheet"); if (!sh) return;
    const max = sh.scrollHeight - sh.clientHeight; if (max <= 0) return;
    const prog = S.target.length ? S.typed.length / S.target.length : 0;
    const target = Math.round(prog * max);
    if (paperHold) { if (Math.abs(sh.scrollTop - target) <= 48) paperHold = false; else return; }
    if (Math.abs(sh.scrollTop - target) < 2) return;
    paperProgScroll = true; sh.scrollTop = target;
    requestAnimationFrame(function () { paperProgScroll = false; });
  }
  function scrollPaperTyped() {
    /* Typed box: keep the caret's line in view with nearest semantics —
       if it slips below the bottom, scroll just enough to rest it one
       line above the bottom edge; if it rises above the top (backspacing
       up), just enough to rest it one line below the top edge.
       v19: after a real key event the browser natively "reveals"
       the caret inside the hidden #capture textarea, and because
       that textarea is a child of this scroll box, the reveal
       re-scrolls the BOX to the caret's position in the TEXTAREA's
       own (different-font, different-wrap) layout — overriding this
       function's synchronous set and pinning the box to a lagging
       position that saturates once the textarea scrolls internally.
       (Proven by CDP instrumentation on the v18 code: the app set
       the correct advancing values every keystroke while the
       effective scrollTop stayed frozen at the textarea-layout
       position — 218px on the repro passage — and a manual scroll
       to the caret was yanked back to that same pin.) The fix is
       timing: the input handler re-asserts this follow in its
       post-input rAF, after the reveal has landed — the same
       pattern screen view always used, which is why screen view
       never showed the bug. A typeBox scroll guard (wired with the
       stage's listeners) is kept as a second layer: if any scroll
       lands within 400ms of a keystroke with the caret outside the
       zone, it re-runs this follow against the live caret.
       Programmatic value sets and CDP insertText don't trigger the
       native reveal, which is why synthetic tests missed this for
       two versions; and always verify scroll fixes in a FRESH
       browser profile — a long-lived test browser once served
       pre-fix code and made the working fix look broken. */
    const pt = q("#paperTyped"); if (!pt) return;
    const caret = pt.querySelector(".ptCaret"); if (!caret) return;
    const lh = paperLineH(pt, 1.9);
    const lineTop = paperLineTop(caret, typeBox);
    const lineBottom = lineTop + lh;
    const viewTop = typeBox.scrollTop, viewBottom = viewTop + typeBox.clientHeight;
    let desired = viewTop;
    if (lineBottom > viewBottom) desired = lineBottom + lh - typeBox.clientHeight;
    else if (lineTop < viewTop) desired = lineTop - lh;
    const max = Math.max(0, typeBox.scrollHeight - typeBox.clientHeight);
    if (desired > max) desired = max;
    if (desired < 0) desired = 0;
    if (desired !== typeBox.scrollTop) typeBox.scrollTop = desired;
  }
  function focusCapture() {
    try { capture.focus({ preventScroll: true }); } catch (e) { capture.focus(); }
  }

  /* Paper View typing box: in Paper View the sheet carries the passage
     (read-only and plain — no tracking of any kind, v16) and this box —
     inside the type box, in place of the type-over-words text — shows
     ONLY what the user has typed, as plain text with a caret. The box is
     a fixed-height pane (CSS .typeBox.paperBox); scrollPaperTyped()
     keeps the caret line in view with minimal movement (v17). The input
     path (the capture textarea) is untouched. */
  function renderPaperTyped() {
    const el = q("#paperTyped"); if (!el) return;
    const v = typedString();
    if (!v) { el.innerHTML = '<span class="ph">Start typing — your text appears here…</span>'; return; }
    const c = Math.max(0, Math.min(S.caret || 0, v.length));
    el.innerHTML = escapeHtml(v.slice(0, c)) + '<span class="ptCaret" aria-hidden="true"></span>' + escapeHtml(v.slice(c));
  }

  /* ---------- Paper View 2.0 ---------- */
  function updatePaperSheet() {
    const el = q("#paperSheetText"); if (!el) return;
    el.innerHTML = S.target.split(" ").map(function (w) { return '<span class="pw">' + escapeHtml(w) + '</span>'; }).join(" ");
    paintPaperLine();
  }
  function paintPaperLine() {
    /* v16: REMOVED — the paper sheet carries NO tracking at all (no bold
       current word, no current-line highlight). The sheet is a static
       print; progress shows only in the typed box. Kept as a no-op
       because renderText()/updatePaperSheet() still call it. */
  }
  function paintPaperLayout() {
    /* v19: ONE Paper View layout — Top/Bottom, like the pre-redesign
       site (which had no layout switcher at all). Side-by-Side is
       removed: the stage always renders Top/Bottom, and a stored
       SETTINGS.paperLayout === "side" is simply never applied (the
       stored settings key itself is left exactly as it is). */
    const area = q("#typeArea"); if (area) area.classList.remove("side");
  }
  function scrollStageIntoView() {
    /* v18: ONE page scroll, only on entering Paper View (setPaperView's
       sole caller is the Paper toggle) — land the stage with the HUD
       just under the sticky site header, so HUD + sheet + typed box are
       on screen together with no manual arranging. Never per keystroke;
       leaving Paper View adjusts nothing.
       v23: on exam mounts the HUD strip no longer exists — the anchor
       becomes the type area, and the landing mark moves down by the
       sticky timer pill (header + pill + a gap), so the sheet's first
       line never sits under the pill. Practice mounts keep the v18
       HUD anchoring byte-for-byte. */
    const anchor = pill ? (q("#typeArea") || q("#hcmStage")) : (q("#stHud") || q("#hcmStage")); if (!anchor) return;
    const hdr = document.querySelector(".site-header");
    const clearance = function () {
      const hh = hdr ? hdr.getBoundingClientRect().height : 0;
      if (!pill) return hh + 6;
      return hh + 8 + (pill.el.getBoundingClientRect().height || 0) + 8;
    };
    const y = anchor.getBoundingClientRect().top + window.scrollY - clearance();
    if (!(y > 0)) return;
    /* Instant scroll, then a short settle loop of verify-and-correct
       passes on widening delays, re-measuring live rects each time
       (never the captured numbers): async stage content (the passage
       module finishing its load) can shift the stage for a moment after
       entering, and the passes nudge only while it sits off the mark.
       Every pass stays strictly inside this toggle-only path — never
       per keystroke. */
    window.scrollTo(0, y);
    const correct = function () {
      if (!S.paperView || !anchor.isConnected) return; /* toggled off / stage gone */
      /* Bottom clamp: on tall viewports the document may not be tall
         enough to scroll the anchor all the way to the mark — once the
         page is at its scroll limit the anchor is as high as it can go
         (and fully visible), so further nudges are futile. */
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      if (window.scrollY >= maxY - 1) return;
      const off = anchor.getBoundingClientRect().top - clearance();
      if (Math.abs(off) > 4) window.scrollTo(0, window.scrollY + off);
    };
    requestAnimationFrame(correct);
    [200, 600, 1200, 2000].forEach(function (ms) { setTimeout(correct, ms); });
  }
  function setPaperView(on) {
    S.paperView = !!on;
    const wrap = q("#paperWrap"); if (wrap) wrap.style.display = S.paperView ? "block" : "none";
    typeBox.classList.toggle("paperBox", S.paperView);
    renderText();
    if (S.paperView) {
      updatePaperSheet();
      paintPaperLayout();
      applyPaperFont();
      paperHold = false;
      const sh = q("#paperSheet"); if (sh) sh.scrollTop = 0;
      renderText();
      requestAnimationFrame(scrollStageIntoView);
    }
  }

  /* Text size application (constants + step reader are module-level,
     above): the current step applied to every typing surface of this
     stage — the screen-view passage text, the paper sheet and the
     paper typed box. The command bar paints the pills' active state
     itself from the same step (paintBar passes fontStep). */
  function applyPaperFont() {
    const step = paperFontStep(), px = PAPER_FONT_SIZES[step];
    const tt = q("#typeText"); if (tt) tt.style.fontSize = px + "px";
    const sh = q("#paperSheetText"); if (sh) sh.style.fontSize = px + "px";
    const pt = q("#paperTyped");
    if (pt) { pt.style.fontSize = px + "px"; pt.style.minHeight = (px * 1.9 * 3) + "px"; }
  }

  /* ---------- stats (verbatim) ---------- */
  function typedString() { let v = ""; S.typed.forEach(function (x) { v += x.ch; }); return v; }
  function stats(el) {
    const typedStr = typedString(), pos = typedStr.length;
    const al = alignWordsHcm(S.target, typedStr);
    const mins = Math.max(el, 1) / 60;
    const W5 = Math.round(pos / 5);
    const gross = W5 / mins;
    const net = Math.max(0, (W5 - 10 * al.mistakes) / mins);
    const acc = W5 ? Math.max(0, Math.min(100, (W5 - al.mistakes) / W5 * 100)) : 100;
    const accChar = pos ? (al.correctChars / pos * 100) : 100;
    const words = W5;
    return { pos: pos, errs: al.mistakes, gross: gross, net: net, acc: acc, accChar: accChar, words: words };
  }
  function updateStats(el) {
    const s = stats(el || (S.started ? (Date.now() - S.startT) / 1000 : 0));
    /* v23: on exam mounts the Net WPM / Predicted marks cells no
       longer exist — the stats are still computed exactly as before
       (finishTest recomputes them for the result screen regardless);
       only the mid-test painting is skipped when the cells are
       absent. Practice mounts paint them exactly as before. */
    const sn = q("#sNet"); if (sn) sn.textContent = Math.round(s.net);
    const m = q("#sMarks");
    if (m) {
      if (!S.started || s.pos < 10) { m.textContent = "—"; }
      else { const mk = hcmMarksFor(s.net); m.textContent = s.net < 30 ? "0 · DQ" : mk + " / 25"; }
    }
    if (!isExamCtx()) {
      const pb2 = q("#progBar");
      if (pb2) pb2.style.width = (S.target.length ? Math.min(100, s.pos / S.target.length * 100) : 0) + "%";
    }
  }
  function startTimer() {
    S.started = true; S.startT = Date.now();
    zen.enter();
    paintSubmitBtn();
    S.timer = setInterval(function () {
      const el = (Date.now() - S.startT) / 1000, total = S.durMin * 60;
      if (!isExamCtx()) {
        q("#sTime").textContent = fmtTime(el);
        q("#progBar").style.width = (S.target.length ? Math.min(100, S.typed.length / S.target.length * 100) : 0) + "%";
        updateStats(el);
        if (S.capSec && el >= S.capSec) finishTest();
        return;
      }
      paintPill(total - el, total);
      updateStats(el);
      if (el >= total) finishTest();
    }, 200);
  }

  /* ---------- input path (verbatim ports) ---------- */
  let pendingWinY = null, pendingWinX = null;
  capture.addEventListener("input", function () {
    if (S.finished) return;
    lastPaperInputAt = performance.now();
    const wy = (pendingWinY != null ? pendingWinY : window.scrollY), wx = (pendingWinX != null ? pendingWinX : window.scrollX);
    let v = capture.value;
    TEL.feed(v);
    if (!S.started && v.length > 0) startTimer();
    if (v.length > S.target.length) {
      const csCap = capture.selectionStart;
      v = v.slice(0, S.target.length);
      capture.value = v;
      const csNew = Math.max(0, Math.min(csCap != null ? csCap : v.length, v.length));
      try { capture.setSelectionRange(csNew, csNew); } catch (e) {}
    }
    S.errCat = { spelling: 0, capital: 0, punct: 0, spacing: 0, other: 0 }; S.errKeys = {}; S.errWords = {};
    S.typed = [];
    for (let i = 0; i < v.length && i < S.target.length; i++) {
      const exp = S.target[i], got = v[i], ok = exp === got;
      S.typed.push({ ch: got, ok: ok });
      if (!ok) {
        S.errCat[classifyChar(exp, got)]++;
        S.errKeys[exp] = (S.errKeys[exp] || 0) + 1;
        const w = currentWord(i); if (w) S.errWords[w] = (S.errWords[w] || 0) + 1;
      }
    }
    const dfl = displayFlagsHcm(S.target, v.slice(0, S.typed.length));
    for (let di = 0; di < S.typed.length; di++) { S.typed[di].ok = !!dfl[di]; }
    const selNow = capture.selectionStart;
    S.caret = Math.max(0, Math.min(selNow != null ? selNow : S.typed.length, S.typed.length));
    renderText(); updateStats(S.started ? (Date.now() - S.startT) / 1000 : 0);
    requestAnimationFrame(function () {
      if (window.scrollY !== wy || window.scrollX !== wx) window.scrollTo(wx, wy);
      if (S.paperView) scrollPaperTyped();
      else scrollCursorIntoView(S.caret);
      pendingWinY = null; pendingWinX = null;
    });
    const mhEl = q("#modeHint");
    if (S.typed.length >= S.target.length) {
      if (mhEl) mhEl.textContent = isExamCtx()
        ? "Text complete — timer still running. You can still correct anything; press Submit when ready."
        : "Text complete — that's the whole text. You can still correct anything; press Finish to see your result.";
    } else if (mhEl && mhEl.textContent.indexOf("Text complete") === 0) {
      mhEl.textContent = "";
    }
    paintSubmitBtn();
  });
  function currentWord(pos) {
    const t = S.target; let s = pos; while (s > 0 && t[s - 1] !== " ") s--;
    let e = pos; while (e < t.length && t[e] !== " ") e++;
    return t.slice(s, e);
  }
  function setHcmCaret(c) {
    c = Math.max(0, Math.min(c, S.typed.length));
    S.caret = c;
    try { capture.setSelectionRange(c, c); } catch (e) {}
    renderText();
  }
  function syncHcmCaret() {
    if (S.finished) return;
    const cs = capture.selectionStart; if (cs == null) return;
    const c2 = Math.max(0, Math.min(cs, S.typed.length));
    if (c2 !== S.caret) { S.caret = c2; renderText(); }
  }
  function hcmLineCaret(dir) {
    const kids = typeText.children, total = kids.length;
    if (!total) return S.caret;
    const c = Math.max(0, Math.min(S.caret || 0, S.typed.length));
    const anchorIdx = Math.min(c, total - 1);
    const anchor = kids[anchorIdx];
    const aTop = anchor.offsetTop;
    const aLeft = c < total ? anchor.offsetLeft : anchor.offsetLeft + anchor.offsetWidth;
    const rowTops = [];
    for (let i = 0; i < total; i++) { if (rowTops.indexOf(kids[i].offsetTop) < 0) rowTops.push(kids[i].offsetTop); }
    rowTops.sort(function (a, b) { return a - b; });
    if (dir === "home" || dir === "end") {
      let first = -1, last = -1;
      for (let j = 0; j < total; j++) { if (kids[j].offsetTop === aTop) { if (first < 0) first = j; last = j; } }
      if (first < 0) return c;
      return dir === "home" ? Math.min(first, S.typed.length) : Math.min(last + 1, S.typed.length);
    }
    let targetTop = null, ri;
    if (dir === "up") { for (ri = rowTops.length - 1; ri >= 0; ri--) { if (rowTops[ri] < aTop) { targetTop = rowTops[ri]; break; } } }
    else { for (ri = 0; ri < rowTops.length; ri++) { if (rowTops[ri] > aTop) { targetTop = rowTops[ri]; break; } } }
    if (targetTop == null) return c;
    let best = -1, bestD = Infinity;
    for (let k = 0; k < total; k++) {
      if (kids[k].offsetTop !== targetTop) continue;
      const d = Math.abs(kids[k].offsetLeft - aLeft);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best < 0) return c;
    const lastSpan = kids[best];
    const nc = (aLeft > lastSpan.offsetLeft + lastSpan.offsetWidth) ? best + 1 : best;
    return Math.max(0, Math.min(nc, S.typed.length));
  }
  /* v21: line navigation in Paper View. hcmLineCaret reads the
     screen-view .ch spans, which are display:none in Paper View (all
     offsets 0), so Up/Down/Home/End were broken there (Home -> 0,
     End -> end of text, Up/Down no-ops). #paperTyped holds the typed
     text as plain text nodes, so measure lines from per-character
     Range rects instead: characters on one visual line share a rect
     top, lines sit ~one line-height apart. Only the caret's own line
     and the target line are ever scanned. Mirrors hcmLineCaret's
     contract: returns a caret index in [0, S.typed.length]; home/end
     go to the current line's edges; up/down pick the character on the
     adjacent line nearest the caret's horizontal position. */
  function paperLineCaret(dir) {
    const total = S.typed.length;
    if (!total) return 0;
    const pt = q("#paperTyped");
    if (!pt) return hcmLineCaret(dir);
    const c = Math.max(0, Math.min(S.caret, total));
    const walker = document.createTreeWalker(pt, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n, acc = 0;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue) continue;
      nodes.push({ node: n, start: acc, len: n.nodeValue.length });
      acc += n.nodeValue.length;
    }
    if (!nodes.length) return c;
    const range = document.createRange();
    function rectOf(idx) {
      idx = Math.max(0, Math.min(idx, total - 1));
      let it = nodes[nodes.length - 1];
      for (const cand of nodes) { if (idx < cand.start + cand.len) { it = cand; break; } }
      const off = Math.min(idx - it.start, Math.max(0, it.len - 1));
      range.setStart(it.node, off);
      range.setEnd(it.node, Math.min(off + 1, it.len));
      const r = range.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right };
    }
    const anchorIdx = Math.min(c, total - 1);
    const a = rectOf(anchorIdx);
    const anchorLeft = c < total ? a.left : a.right;
    const sameLine = (idx) => Math.abs(rectOf(idx).top - a.top) < 2;
    if (dir === "home" || dir === "end") {
      let first = anchorIdx, last = anchorIdx;
      while (first > 0 && sameLine(first - 1)) first--;
      while (last < total - 1 && sameLine(last + 1)) last++;
      return dir === "home" ? first : Math.min(last + 1, total);
    }
    if (dir === "down") {
      let i = anchorIdx;
      while (i < total - 1 && sameLine(i + 1)) i++;
      if (i >= total - 1) return c;
      const targetTop = rectOf(i + 1).top;
      let best = i + 1, bestD = Infinity, j = i + 1, lastRect = null;
      while (j < total && Math.abs(rectOf(j).top - targetTop) < 2) {
        const r = rectOf(j); lastRect = r;
        const d = Math.abs(r.left - anchorLeft);
        if (d < bestD) { bestD = d; best = j; }
        j++;
      }
      if (lastRect && Math.abs(lastRect.right - anchorLeft) < bestD) best = j;
      return Math.max(0, Math.min(best, total));
    }
    /* up */
    let i = anchorIdx;
    while (i > 0 && sameLine(i - 1)) i--;
    if (i <= 0) return c;
    const targetTop = rectOf(i - 1).top;
    let best = i - 1, bestD = Infinity, j = i - 1;
    while (j >= 0 && Math.abs(rectOf(j).top - targetTop) < 2) {
      const d = Math.abs(rectOf(j).left - anchorLeft);
      if (d < bestD) { bestD = d; best = j; }
      j--;
    }
    return Math.max(0, Math.min(best, total));
  }
  capture.addEventListener("keydown", function (e) {
    pendingWinY = window.scrollY; pendingWinX = window.scrollX;
    if (e.key === "Backspace" && !bsEffective()) { e.preventDefault(); return; }
    if (e.key === "Backspace" && !S.finished) S.bsCount++;
    if (S.finished) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "Home" ? "home" : "end";
      setHcmCaret(S.paperView ? paperLineCaret(dir) : hcmLineCaret(dir));
    }
  });
  capture.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") syncHcmCaret();
  });
  capture.addEventListener("select", function () { syncHcmCaret(); });
  /* v21: Paper View click-to-place-caret. #paperTyped renders the typed
     text as plain text around a zero-width .ptCaret span — there are no
     .ch spans for the click handler below to land on, so every Paper
     View click used to fall through to caret-at-end and the user could
     not click back into their typed text to fix a mistake (the
     free-cursor editing the screen view has always had). Resolve the
     click point to a character index in the typed string the same way
     the EX stage does (exCaretFromPoint): caretRangeFromPoint gives a
     (node, offset); walk #paperTyped's text nodes in document order to
     make it a global index. The .ptCaret span carries no text, so it
     contributes nothing; the placeholder span exists only when nothing
     is typed yet, and setHcmCaret clamps the result to the typed
     length either way. Returns null when the point resolves to no
     text position inside #paperTyped (box padding, empty area). */
  function paperCaretFromPoint(x, y) {
    const pt = q("#paperTyped");
    if (!pt || !document.caretRangeFromPoint) return null;
    const r = document.caretRangeFromPoint(x, y);
    if (!r || !pt.contains(r.startContainer)) return null;
    const node = r.startContainer;
    if (node === pt) {
      let idx = 0;
      for (let i = 0; i < r.startOffset && i < pt.childNodes.length; i++) idx += (pt.childNodes[i].textContent || "").length;
      return idx;
    }
    if (node.nodeType !== 3) return null;
    let idx = 0;
    const walker = document.createTreeWalker(pt, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n === node) return idx + r.startOffset;
      idx += n.length;
    }
    return null;
  }
  typeBox.addEventListener("click", function (e) {
    focusCapture(); typeBox.classList.add("focused");
    if (S.finished) return;
    if (S.paperView) {
      /* v21: place the caret where the user clicked in the typed text
         (see paperCaretFromPoint). A click that resolves to no text
         position keeps the old behaviour: caret at the end. */
      const pIdx = paperCaretFromPoint(e.clientX, e.clientY);
      setHcmCaret(pIdx == null ? S.typed.length : pIdx);
      return;
    }
    const span = (e.target && e.target.classList && e.target.classList.contains("ch")) ? e.target : null;
    if (span) {
      const idx = Array.prototype.indexOf.call(typeText.children, span);
      if (idx >= 0) {
        const r = span.getBoundingClientRect();
        setHcmCaret(idx + ((e.clientX > r.left + r.width / 2) ? 1 : 0));
      }
    } else {
      setHcmCaret(S.typed.length);
    }
  });
  typeBox.addEventListener("keydown", function (e) {
    if (e.target === capture) return;
    if (e.key === "PageDown" || e.key === "PageUp") { e.preventDefault(); focusCapture(); return; }
    if (e.key === "Backspace") {
      e.preventDefault(); focusCapture();
      if (S.finished) return;
      if (!bsEffective()) return;
      if (capture.value.length) {
        S.bsCount++;
        capture.value = capture.value.slice(0, -1);
        capture.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (e.key && e.key.length === 1) {
      e.preventDefault(); focusCapture();
      if (!S.finished) {
        capture.value += e.key;
        capture.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (document.activeElement !== capture) focusCapture();
  });
  capture.addEventListener("blur", function () { typeBox.classList.remove("focused"); });

  /* ---------- scoring helpers (verbatim) ---------- */
  function computeMistakes() {
    const al = alignWordsHcm(S.target || "", typedString());
    const map = {}, order = [];
    al.pairs.forEach(function (p) {
      if (p.kind === "ok") return;
      let exp, got;
      if (p.kind === "sub") { exp = p.exp; got = p.got; }
      else if (p.kind === "spacing") { exp = p.exp; got = p.got; }
      else if (p.kind === "del") { exp = p.exp; got = "(missed)"; }
      else { exp = "(extra)"; got = p.got; }
      const key = exp + "" + got;
      if (!map[key]) { map[key] = { exp: exp, got: got, count: 0 }; order.push(map[key]); }
      map[key].count++;
    });
    order.sort(function (a, b) { return b.count - a.count; });
    const uniq = []; order.forEach(function (r) { if (r.exp !== "(extra)" && uniq.indexOf(r.exp) < 0) uniq.push(r.exp); });
    return { rows: order.slice(0, 40), total: al.mistakes, unique: uniq };
  }
  function deriveErrCats() {
    const al = alignWordsHcm(S.target || "", typedString());
    const cat = { spelling: 0, capital: 0, punct: 0, spacing: 0, other: 0 }, keys = {}, words = {};
    al.pairs.forEach(function (p) {
      if (p.kind === "ok") return;
      if (p.kind === "spacing") { cat.spacing++; keys[" "] = (keys[" "] || 0) + 1; p.exp.split(" ").forEach(function (w) { if (w) words[w] = (words[w] || 0) + 1; }); return; }
      if (p.kind === "del") { cat.other++; words[p.exp] = (words[p.exp] || 0) + 1; return; }
      if (p.kind === "ins") { cat.other++; return; }
      const e = p.exp, g = p.got;
      if (e.length !== g.length && (e.indexOf(g) === 0 || g.indexOf(e) === 0)) {
        cat.spacing++; keys[" "] = (keys[" "] || 0) + 1;
      } else {
        const lim = Math.max(e.length, g.length); let counted = false;
        for (let i2 = 0; i2 < lim; i2++) {
          const ec = i2 < e.length ? e[i2] : "", gc = i2 < g.length ? g[i2] : "";
          if (ec === gc) continue;
          if (!counted) { cat[classifyChar(ec || " ", gc || " ")]++; counted = true; }
          const kk = ec || gc; keys[kk] = (keys[kk] || 0) + 1;
        }
      }
      words[e] = (words[e] || 0) + 1;
    });
    S.errCat = cat; S.errKeys = keys; S.errWords = words;
  }
  function practiceLine(s) {
    if (s.pos > 0 && s.errs === 0) return "Not a single error — that's exam-grade control.";
    if (s.accChar >= 98) return "Accuracy at the 98% gate — exam-grade control. Speed will follow.";
    const cats = [["spelling", "Biggest leak: spelling — slow down on the words that broke, not everywhere."],
      ["capital", "Biggest leak: capitals — opposite-hand Shift, every single time."],
      ["punct", "Biggest leak: punctuation — read the marks as part of the word."],
      ["spacing", "Biggest leak: spacing — one space after punctuation, always."],
      ["other", "Biggest leak: skipped or extra words — keep your eyes a phrase ahead of your fingers."]];
    let top = null, topN = 0;
    cats.forEach(function (c) { const n = S.errCat[c[0]] || 0; if (n > topN) { topN = n; top = c[1]; } });
    if (top) return top;
    return "Solid practice run — accuracy first, and speed follows.";
  }

  /* ---------- finish (verbatim port of finishTest) ---------- */
  function finishTest() {
    if (S.finished) return; S.finished = true;
    zen.exit();
    clearInterval(S.timer);
    if (pill) pill.hide(); /* v23: the result screen replaces the pill */
    const sbF = q("#submitBtn"); if (sbF) sbF.style.display = "none";
    let el;
    if (isExamCtx()) {
      el = S.started ? Math.min((Date.now() - S.startT) / 1000, S.durMin * 60) : 0;
      if (el <= 0) el = S.durMin * 60;
    } else {
      el = S.started ? (Date.now() - S.startT) / 1000 : 0;
    }
    const s = stats(el), mk = hcmMarksFor(s.net), qual = s.net >= 30;
    deriveErrCats();
    let prevBest = null;
    try { prevBest = lessonStatus(S.currentId).best; } catch (e) {}
    const mres = computeMistakes(); S.lastMistakes = mres.unique;
    const rb = q("#resultBox"); rb.style.display = "block";
    if (isExamCtx()) {
      rb.className = "resultBox" + (qual ? "" : " fail");
      rb.dataset.mode = "exam";
      q("#rTitle").textContent = (S.isDrill ? "Drill result — " : "Test result — ") + S.currentName;
      q("#rVerdict").innerHTML = qual
        ? "✅ <strong>Qualified.</strong> Net " + Math.round(s.net) + " WPM earns <strong>" + mk + " / 25 marks</strong> in the HCM merit list." + (mk === 25 ? " Full marks band — now make this repeatable in the 10-minute simulation." : " Next band needs net " + (s.net <= 35 ? 36 : s.net <= 40 ? 41 : s.net <= 45 ? 46 : 51) + " WPM.")
        : "❌ <strong>Below qualifying speed.</strong> Net " + Math.round(s.net) + " WPM is under the 30 WPM minimum — this would disqualify in the real exam regardless of written marks. Accuracy-first drills below are the fix, not faster typing.";
      q("#rGross").textContent = Math.round(s.gross);
      q("#rNet").textContent = Math.round(s.net);
      q("#rMarks").textContent = qual ? mk + " / 25" : "0 (DQ)";
      q("#rAcc").textContent = s.acc.toFixed(1) + "%";
      const catNames = { spelling: "Spelling / wrong character", capital: "Capitalisation", punct: "Punctuation", spacing: "Spacing", other: "Other / extra–omitted" };
      let rows = ""; Object.keys(catNames).forEach(function (k) { rows += "<tr><td>" + catNames[k] + "</td><td><strong>" + (S.errCat[k] || 0) + "</strong></td></tr>"; });
      rows += "<tr><td><strong>Total errors</strong></td><td><strong>" + s.errs + "</strong></td></tr>";
      q("#rBreak").innerHTML = rows;
      const wk = Object.keys(S.errKeys).sort(function (a, b) { return S.errKeys[b] - S.errKeys[a]; }).slice(0, 6)
        .map(function (k) { return "'" + (k === " " ? "space" : k) + "' ×" + S.errKeys[k]; }).join(", ");
      const ww = Object.keys(S.errWords).sort(function (a, b) { return S.errWords[b] - S.errWords[a]; }).slice(0, 6)
        .map(function (k) { return k + " ×" + S.errWords[k]; }).join(", ");
      q("#rWeak").innerHTML = (wk ? ("Weakest keys: <strong>" + wk + "</strong><br>") : "No key errors — clean run.<br>") + (ww ? ("Words with errors: <strong>" + ww + "</strong>") : "");
      let next = "Repeat this same text once slowly at 98%+ accuracy before trying anything faster.";
      if (S.errCat.capital >= 3) next = "Your capitals are leaking marks — do Part 2 → Opposite-Hand Shift drill next, then re-test.";
      else if (S.errCat.spacing >= 3) next = "Spacing is your leak — do Part 5 → Spacing Traps next. One space after punctuation, always.";
      else if (S.errCat.punct >= 3) next = "Punctuation errors are full mistakes in HCM — do Part 5 → Punctuation, Numbers, Dates next.";
      else if (s.accChar >= 98 && s.net < 30) next = "Accuracy is exam-grade. Now build speed with Part 3 n-gram chunks and Part 6 Level 2–3 sentences.";
      else if (s.acc < 95) next = "Accuracy below 95% is costing you a full marks band. Go back to Part 1 row drills for the row your weakest keys live on, at the 98% gate.";
      else if (S.isDrill && s.accChar >= 98) next = "Accuracy Gate passed ✅ — this drill is marked complete. Move to the next drill in the part.";
      q("#rNext").textContent = next;
      q("#rKeys").textContent = s.pos;
      q("#rBs").textContent = S.bsCount || 0;
      q("#rTimeUsed").textContent = fmtTime(Math.round(el)) + " / " + fmtTime(S.durMin * 60);
      q("#rWordsN").textContent = s.words;
      const minsF = el / 60;
      q("#rCalc").innerHTML = "<h3>How your marks were calculated — the HCM way</h3><table><tbody>"
        + "<tr><td>Keystrokes typed (characters, incl. spaces)</td><td><strong>" + s.pos + "</strong></td></tr>"
        + "<tr><td>Backspaces used</td><td><strong>" + (S.bsCount || 0) + "</strong></td></tr>"
        + "<tr><td>Time</td><td><strong>" + minsF.toFixed(2) + " min</strong></td></tr>"
        + "<tr><td>Gross speed = keystrokes ÷ 5 ÷ minutes</td><td><strong>" + s.pos + " ÷ 5 ÷ " + minsF.toFixed(2) + " = " + Math.round(s.gross) + " WPM</strong></td></tr>"
        + "<tr><td>Words (keystrokes ÷ 5)</td><td><strong>" + s.words + "</strong></td></tr>"
        + "<tr><td>Mistakes (words — HCM counts no half mistakes)</td><td><strong>" + s.errs + "</strong></td></tr>"
        + "<tr><td>Net speed = (words − 10 × mistakes) ÷ minutes</td><td><strong>(" + s.words + " − 10 × " + s.errs + ") ÷ " + minsF.toFixed(2) + " = " + Math.round(s.net) + " WPM</strong></td></tr>"
        + "<tr><td>Marks</td><td><strong>" + (qual ? mk : 0) + " / 25</strong> — " + hcmBandLabel(s.net) + "</td></tr>"
        + "</tbody></table>";
      let mh = "<h3>Word-by-word mistakes (" + mres.total + ")</h3>";
      if (!mres.rows.length) {
        mh += "<p class='small'>No word mistakes — every word you reached was typed exactly as printed. 🎉</p>";
      } else {
        mh += "<div style='overflow-x:auto'><table><tr><th>Correct word</th><th>You typed</th><th>Times</th></tr>";
        mres.rows.forEach(function (r) {
          mh += "<tr><td class='mono'>" + escapeHtml(r.exp) + "</td><td class='mono' style='color:var(--error)'>" + escapeHtml(r.got || "(missed)") + "</td><td>" + r.count + "</td></tr>";
        });
        mh += "</table></div><p class='small'>Fix these exact words — tap <strong>Practise my mistakes</strong> below and they become a drill.</p>";
      }
      q("#rMistakes").innerHTML = mh;
      const mbEl = q("#mistakeBtn"); if (mbEl) mbEl.style.display = mres.unique.length ? "" : "none";
      const cmpEl = q("#rCompare");
      if (cmpEl) {
        const alC = alignWordsHcm(S.target || "", typedString());
        const eSt = [], gSt = [], cCounts = { spelling: 0, capital: 0, punct: 0, spacing: 0, skipped: 0, extra: 0 };
        alC.pairs.forEach(function (p) {
          if (p.kind === "ok") { eSt.push({ st: "ok", cat: "ok" }); gSt.push({ st: "ok", cat: "ok" }); }
          else if (p.kind === "del") { eSt.push({ st: "full", cat: "skipped" }); cCounts.skipped++; }
          else if (p.kind === "ins") { gSt.push({ st: "full", cat: "extra" }); cCounts.extra++; }
          else if (p.kind === "spacing") {
            eSt.push({ st: "full", cat: "spacing" }); if (p.exp.indexOf(" ") >= 0) eSt.push({ st: "full", cat: "spacing" });
            gSt.push({ st: "full", cat: "spacing" }); if (p.got.indexOf(" ") >= 0) gSt.push({ st: "full", cat: "spacing" });
            cCounts.spacing++;
          }
          else {
            let cc = classifyPair(p.exp, p.got); if (cc === "ok") cc = "spelling";
            eSt.push({ st: "full", cat: cc }); gSt.push({ st: "full", cat: cc }); cCounts[cc]++;
          }
        });
        const eToksC = hcmWordTokens(S.target || "").map(function (t) { return t.w; });
        const gToksC = hcmWordTokens(typedString()).map(function (t) { return t.w; });
        cmpEl.innerHTML = "<h3>Passage comparison</h3>" + cmpComparisonHtml(eToksC, gToksC, eSt, gSt, cCounts, false);
      }
      [["rNetRing", Math.min(100, s.net / 2)], ["rAccRing", s.acc], ["rMarksRing", (qual ? mk : 0) / 25 * 100]].forEach(function (cfg) {
        const rc2 = document.getElementById(cfg[0]); if (rc2) rc2.setAttribute("data-pct", String(Math.max(0, cfg[1])));
      });
      animateRings(rb);
      const prHide = q("#pracResult"); if (prHide) prHide.style.display = "none";
    } else {
      rb.className = "resultBox practiceMode";
      rb.dataset.mode = "practice";
      q("#rTitle").textContent = "Practice result — " + S.currentName;
      const pr = q("#pracResult"); if (pr) pr.style.display = "block";
      const setT = function (id, v) { const n = q("#" + id); if (n) n.textContent = v; };
      setT("prNet", Math.round(s.net));
      setT("prAcc", s.acc.toFixed(1) + "%");
      setT("prTime", fmtTime(Math.round(el)));
      setT("prErr", s.errs);
      setT("prWords", s.words);
      setT("prGross", Math.round(s.gross));
      setT("prLine", practiceLine(s));
      const tg = q("#prTarget");
      if (tg) {
        if (S.isDrill) { tg.style.display = ""; tg.textContent = s.accChar >= 98 ? "Target 98% — reached 🎯" : "Target 98% — you hit " + s.accChar.toFixed(1) + "%"; }
        else tg.style.display = "none";
      }
      const pbEl = q("#prBest");
      if (pbEl) pbEl.style.display = (prevBest && Math.round(s.net) > (prevBest.net || 0)) ? "" : "none";
      if (pbEl && pbEl.style.display === "" && !S.isDrill) { try { celebrateIfBest(Math.round(s.net), loadHist(), null); } catch (e) {} }
      const nbEl = q("#prNextBtn");
      if (nbEl) {
        const hasNext = !!(S.silo && S.silo.items && S.silo.index < S.silo.items.length - 1);
        nbEl.textContent = hasNext ? "Next →" : "Finish — back to list";
      }
    }

    const nowIso = new Date().toISOString();
    const entry = { clientId: newClientId(), ts: nowIso, d: new Date().toLocaleString("en-IN"), name: S.currentName, part: (S.currentName || ""), gross: Math.round(s.gross), net: Math.round(s.net), acc: +s.acc.toFixed(1), errs: s.errs, marks: qual ? mk : 0, min: S.durMin, durSec: Math.round(el), chars: s.pos, words: s.words, bs: S.bsCount || 0, examMode: false, errCat: Object.assign({}, S.errCat), weakKeys: Object.assign({}, S.errKeys), weakWords: Object.assign({}, S.errWords), synced: false };

    try {
      const fx = buildHcmTelemetry(mres, S.target, typedString());
      if (fx) {
        if (fx.tel) entry.telemetry = fx.tel;
        if (fx.feed && fx.feed.length) entry.mistakeDetail = fx.feed.slice(0, 60);
        if (!S.isDrill) revFeed(fx.feed, "hcm");
      }
    } catch (e) { console.warn("Telemetry failed", e); }
    if (!entry.mistakeDetail && mres.rows.length) entry.mistakeDetail = mres.rows.filter(function (r) { return r.exp !== "(extra)"; }).map(function (r) { return { exp: r.exp, got: r.got, st: "full" }; });
    window.__lastResult = { name: entry.name, date: entry.d, min: entry.min, durSec: entry.durSec, gross: entry.gross, net: entry.net, acc: entry.acc, errs: entry.errs, marks: entry.marks, band: hcmBandLabel(s.net) };
    const h = loadHist(); h.unshift(entry); saveHist(h);
    window.__lastEntryClientId = entry.clientId;

    if (S.currentId === "mistakeDrill" && typeof opts.onMistakeDrillResult === "function") { try { opts.onMistakeDrillResult(mres, s); } catch (e) { console.warn("Mistake-drill progress failed", e); } }
    if (S.currentId === "revisionStream" && typeof opts.onRevisionStreamResult === "function") { try { opts.onRevisionStreamResult(); } catch (e) { console.warn("Revision stream progress failed", e); } }

    const rc = q("#rCloud");
    if (appState.user) {
      if (rc) rc.textContent = "Saving to cloud…";
      cloud.saveResult(entry).then(function (ok) {
        if (rc) rc.textContent = ok ? "Saved to cloud ✓ — this result is in your account and in Trends." : "Saved on this device only — cloud save failed, check connection and log in again.";
      });
    } else if (rc) { rc.textContent = "Saved on this device only — log in to also save it to your account."; }

    if (S.isDrill && s.accChar >= 98) { const dn = loadDone(); dn[S.currentId] = true; saveDone(dn); }
    if (s.pos > 0 && S.currentId) {
      const recentEntry = { d: entry.d, ts: nowIso, gross: Math.round(s.gross), net: Math.round(s.net), acc: +s.acc.toFixed(1), errs: s.errs, marks: (s.net < 30 ? 0 : hcmMarksFor(s.net)), min: S.durMin };
      try { pushBest(S.currentId, recentEntry); } catch (e) { console.warn("Recent save failed", e); }
      try { if (appState.user) cloud.saveBest(S.currentId); } catch (e) { console.warn("Cloud best save failed", e); }
    }
    updateLessonHistory();
    const fxEl = q("#rForensics");
    if (fxEl) fxEl.innerHTML = entry.telemetry ? forensicsHtml(entry.telemetry, { engine: "E3", examId: "hcm", netWpm: s.net, grossWpm: s.gross, acc: s.acc, chars: s.pos, completion: S.target.length ? (s.pos / S.target.length * 100) : 0, wordsTyped: s.words }) : "";
    try { rb.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
    if (typeof opts.onFinish === "function") opts.onFinish(entry);
    if (isExamCtx()) {
      rb.classList.add("motivHold");
      showMotivation(qual, function () {
        rb.classList.remove("motivHold");
        rb.querySelectorAll(".ringFg").forEach(function (c) { c.style.strokeDashoffset = "201.06"; });
        animateRings(rb);
      });
    }
  }

  /* ---------- lesson history strip (verbatim port) ---------- */
  let lessonHistoryExpanded = false, lessonHistoryForId = null;
  function updateLessonHistory() {
    const wrap = q("#lessonHistory"); if (!wrap) return;
    const id = S.currentId || "", name = S.currentName || "Exercise";
    if (lessonHistoryForId !== id) { lessonHistoryExpanded = false; lessonHistoryForId = id; }
    const map = loadBest(); const arr = Array.isArray(map[id]) ? sortBestArr(map[id]) : [];
    const st = lessonStatus(id);
    if (!arr.length) {
      wrap.innerHTML = "<div class='lhStatic'><span class='lhTitle'>" + escapeHtml(name) + "</span><span class='lhStatus'>Not attempted yet</span></div>";
      wrap.classList.add("isCollapsed"); wrap.classList.remove("isExpanded");
      return;
    }
    const statusPlain = (st.completed ? "✓ Completed" : "Not completed yet") + (st.passed ? " · Accuracy Gate passed (98%+)" : "") + " · " + arr.length + " recent attempt" + (arr.length > 1 ? "s" : "");
    let hh = "<button type='button' class='lhToggle' id='lhToggleBtn' aria-expanded='" + (lessonHistoryExpanded ? "true" : "false") + "'>";
    hh += "<span class='lhTitle'>" + escapeHtml(name) + "</span>";
    hh += "<span class='lhStatus" + (st.completed ? " done" : "") + "'>" + escapeHtml(statusPlain) + "</span>";
    hh += "<span class='lhChev' aria-hidden='true'>" + (lessonHistoryExpanded ? "▾" : "▸") + "</span>";
    hh += "</button>";
    if (lessonHistoryExpanded) {
      hh += "<div class='lhBody' id='lhBody'>";
      hh += "<p style='margin:2px 0 8px'>" + (st.completed ? "<strong style='color:var(--pass)'>✓ Completed</strong>" : "<span style='color:var(--muted)'>Not completed yet</span>") + (st.passed ? " · <span style='color:var(--pass);font-weight:700'>Accuracy Gate passed (98%+)</span>" : "") + " · " + arr.length + " recent attempt" + (arr.length > 1 ? "s" : "") + "</p>";
      const examHist = isExamCtx();
      hh += "<div style='overflow-x:auto'><table><tr><th>Date</th><th>Duration</th><th>Gross</th><th>Net WPM</th><th>Accuracy</th><th>Errors</th>" + (examHist ? "<th>Marks</th>" : "") + "</tr>";
      arr.slice(0, 10).forEach(function (en) {
        hh += "<tr><td>" + escapeHtml(String(en.d || en.ts || "")) + "</td><td>" + (en.min ? en.min + " min" : "—") + "</td><td>" + (en.gross || 0) + "</td><td><strong>" + (en.net || 0) + "</strong></td><td>" + (+en.acc || 0).toFixed(1) + "%</td><td>" + (en.errs || 0) + "</td>" + (examHist ? "<td>" + ((en.net || 0) >= 30 ? (en.marks || 0) + " / 25" : "DQ") + "</td>" : "") + "</tr>";
      });
      hh += "</table></div>";
      hh += "</div>";
    }
    wrap.innerHTML = hh;
    wrap.classList.toggle("isExpanded", lessonHistoryExpanded);
    wrap.classList.toggle("isCollapsed", !lessonHistoryExpanded);
    const tb = wrap.querySelector("#lhToggleBtn");
    if (tb) tb.addEventListener("click", function () { lessonHistoryExpanded = !lessonHistoryExpanded; updateLessonHistory(); });
  }

  /* ---------- mode / duration / submit wiring ---------- */
  function paintSubmitBtn() {
    const sb = q("#submitBtn"); if (!sb) return;
    const show = S.started && !S.finished;
    sb.style.display = show ? "" : "none";
    if (show) {
      const ready = S.target.length > 0 && S.typed.length >= S.target.length;
      if (isExamCtx()) sb.textContent = ready ? "✓ Submit result" : "Submit";
      else sb.textContent = ready ? "✓ Finish" : "Finish";
      sb.classList.toggle("big", ready);
    }
  }
  function setDuration(min) { S.durMin = min; resetTest(); }

  q("#stBack").addEventListener("click", function () { if (typeof opts.onExit === "function") opts.onExit(); });
  q("#stTitle").textContent = opts.title || "";
  q("#submitBtn").addEventListener("click", function () { if (S.started && !S.finished) finishTest(); });
  q("#restartBtn").addEventListener("click", function () { resetTest(); focusCapture(); });
  q("#againBtn").addEventListener("click", function () { resetTest(); focusCapture(); });
  q("#nextBtn").addEventListener("click", function () {
    const s = S.silo;
    if (s && s.items && s.items.length) { loadSiloIndex((s.index + 1) % s.items.length); focusCapture(); }
  });
  q("#mistakeBtn").addEventListener("click", function () { if (typeof opts.onPractiseMistakes === "function") opts.onPractiseMistakes(); });
  q("#rcBtn").addEventListener("click", function () { openResultCard(); });
  q("#prAgainBtn").addEventListener("click", function () { resetTest(); focusCapture(); });
  q("#prNextBtn").addEventListener("click", function () {
    const s = S.silo;
    if (s && s.items && s.index < s.items.length - 1) { loadSiloIndex(s.index + 1); focusCapture(); }
    else if (typeof opts.onExit === "function") opts.onExit();
  });
  q("#prBackBtn").addEventListener("click", function () { if (typeof opts.onExit === "function") opts.onExit(); });
  q("#paperPrint").addEventListener("click", function () { printPassage(S.currentName, S.target); });
  q("#paperSheet").addEventListener("scroll", function () { if (!paperProgScroll) paperHold = true; });
  /* v19 scroll guard (second layer under the input handler's rAF
     re-assert — see scrollPaperTyped): the browser's native
     caret-reveal re-scrolls this box after the render-path set, and
     its scroll fires a scroll event like any other. If a scroll
     lands within 400ms of a keystroke (i.e. it is the reveal, not
     the user) and it left the caret line outside the zone, re-assert
     the follow against the LIVE caret. Our own corrective set also
     fires this listener, but by then the caret is in zone and
     scrollPaperTyped no-ops, so it terminates. Manual scrolls while
     not typing (outside the 400ms window) are never touched — the
     box fights nobody. */
  typeBox.addEventListener("scroll", function () {
    if (!S.paperView || S.finished) return;
    if (performance.now() - lastPaperInputAt > 400) return;
    scrollPaperTyped();
  });
  /* v21: the text-size pills moved to the command bar (onBarAction
     "pfont"); the paper head keeps only the print button. */
  applyPaperFont();

  /* ---------- boot the stage ---------- */
  paintBar();
  if (S.paperView) { q("#paperWrap").style.display = "block"; typeBox.classList.add("paperBox"); }
  if (S.silo && S.silo.items && S.silo.items.length) {
    const it = S.silo.items[S.silo.index || 0];
    loadText(it.id, it.name, it.text, it.isDrill);
    /* Hub launches load with isDrill=false (verbatim startHubTest quirk:
       the silo items carry isDrill=true for picker loads, the initial
       load does not) — opts.initialIsDrill overrides when provided. */
    if (opts.initialIsDrill === false) { S.isDrill = false; }
  }
  if (S.paperView) { updatePaperSheet(); paintPaperLayout(); }

  return {
    destroy: function () { clearInterval(S.timer); zen.destroy(); more.destroy(); if (pill) pill.destroy(); },
    _state: S,
    focus: focusCapture,
    finishNow: finishTest
  };
}

/* =====================================================================
   EXAM STAGE — verbatim port of the current exams.js engine (E1/E2).
   opts: { spec, test, custom:bool, durMin (override), backspaceOverride,
           silo:[tests of this exam] (passage switching), onBack(),
           onFinish(entry), onPractiseMistakes(), onProgress(),
           onExamSwitch(examId) } */
export function mountExamStage(container, opts) {
  const sp = opts.spec;
  const durMin = opts.durMin || sp.durationMin;
  const EX = { spec: sp, test: opts.test, category: sp.categories ? sp.categories[0].id : "", started: false, startT: 0, timer: null, finished: false, caret: 0 };
  const zen = makeZen();

  /* Backspace rule: the base value is the arena's custom override when
     given, else the exam's official rule (sp.backspace). In Official
     Mocks the command-bar toggle flips a session-only override (bsUser);
     openExamTest resets it, so a retake/restart always starts from the
     exam default again. Every input guard reads bsEffective() live. */
  let bsUser = null;
  function bsDefault() { return opts.backspaceOverride != null ? !!opts.backspaceOverride : !!sp.backspace; }
  function bsEffective() { return bsUser != null ? bsUser : bsDefault(); }

  container.innerHTML =
    '<div class="stage-wrap exam-live" id="exStageWrap">' +
      '<div class="stage-top">' +
        '<button class="pill" type="button" id="exBack">← Back</button>' +
        '<span class="stage-title" id="exTitle"></span>' +
        '<span class="badge error" id="exNoBs" style="display:none">No Backspace</span>' +
        '<span style="flex:1"></span>' +
        '<span class="pillStat" id="exCand"></span>' +
        '<span class="pillStat" id="exBsState"></span>' +
      '</div>' +
      '<div class="stage-bar" id="exBar"></div>' +
      morePopHtml() +
      '<div class="exam-menu-pop" id="exExamMenu" hidden></div>' +
      /* v23: NO HUD strip on this stage either — the ring + Time left,
         Net WPM, Error %/Allowance, Words and Keystrokes cells are all
         gone; the sticky timer pill (created below) is the only
         mid-test display, painted from the same tick value. The strip
         carried no controls (all controls live in the command bar and
         the stage-top row), so nothing is re-homed. Scoring at submit
         is untouched — finishExamTest recomputes everything itself. */
      '<div class="card" id="exPrePanel">' +
        '<h2 id="exPreTitle"></h2><p id="exPreInfo" class="sub"></p>' +
        '<div id="exCatWrap"></div>' +
        '<button class="btn" type="button" id="exStartBtn" style="margin-top:14px">Start test</button>' +
      '</div>' +
      '<div id="exStage" style="display:none">' +
        '<div class="exPassage" id="exPassage"></div>' +
        '<div class="exTypedWrap" id="exTypedWrap"><div id="exTyped"></div>' +
          '<textarea id="exCapture" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Type here"></textarea>' +
        '</div>' +
        '<div class="stage-actions">' +
          '<button class="btn" type="button" id="exSubmit">Submit test</button>' +
          '<button class="btn secondary" type="button" id="exCancel">Cancel</button>' +
        '</div>' +
      '</div>' +
      '<div class="kbSection" id="exKbSection" style="display:none"><h3>Finger keyboard — which finger presses which key</h3><div id="keyboard"></div></div>' +
      '<div id="exResultBody" style="display:none"></div>' +
    '</div>';

  const q = function (sel) { return container.querySelector(sel); };
  const exCaptureEl = q("#exCapture");
  const morePop = q(".more-pop");
  const kbSection = q("#exKbSection");
  const more = wireMorePop(morePop, kbSection, function () { return { name: EX.test.name, text: exFullTarget() }; });
  if (SETTINGS.kb) { kbSection.style.display = "block"; kbSection.querySelector("#keyboard").innerHTML = fingerKeyboardHtml(); kbSection.dataset.built = "1"; }
  zen.watchMouse(container);
  /* v23: this stage is always an exam stage — it always gets the
     sticky timer pill. */
  const pill = makeTimerPill();

  /* ---------- command bar ---------- */
  function paintBar() {
    const slot = q("#exBar"); if (!slot) return;
    slot.innerHTML = "";
    const bar = renderCommandBar({
      examLabel: sp.short,
      duration: durMin,
      backspace: bsEffective(),
      backspaceLocked: false,
      liveErrors: false,
      paperView: false,
      fontStep: paperFontStep(),
      onAction: onBarAction
    });
    bar.querySelectorAll('[data-act="duration"]').forEach(function (b) { b.disabled = true; b.setAttribute("data-tip", "Fixed by this exam's pattern"); });
    const er = bar.querySelector('[data-act="errors"]'); if (er) { er.disabled = true; er.setAttribute("data-tip", "Errors are scored at submit on this exam's screen"); }
    const pp = bar.querySelector('[data-act="paper"]'); if (pp) { pp.disabled = true; pp.setAttribute("data-tip", "This exam is typed on screen"); }
    if (!opts.silo) { const ps = bar.querySelector('[data-act="passage"]'); if (ps) ps.disabled = true; }
    slot.appendChild(bar);
  }
  /* v21: text size on this stage's surfaces — the passage and the
     typed display — from the same shared step (module-level reader). */
  function applyExTypeFont() {
    const px = PAPER_FONT_SIZES[paperFontStep()];
    const pg = q("#exPassage"); if (pg) pg.style.fontSize = px + "px";
    const td = q("#exTyped"); if (td) td.style.fontSize = px + "px";
  }
  function onBarAction(name, value) {
    if (name === "pfont") {
      setPaperFontStep(+value); applyExTypeFont(); paintBar(); exFocus();
    }
    else if (name === "exam") {
      const menu = q("#exExamMenu");
      if (!menu.hidden) { menu.hidden = true; return; }
      menu.innerHTML = ["hcm", "chsl", "cgl", "rrb"].map(function (id) {
        return '<button type="button" class="pill" data-sw="' + id + '">' + escapeHtml(({ hcm: "Delhi Police HCM", chsl: "SSC CHSL", cgl: "SSC CGL DEST", rrb: "RRB NTPC" })[id]) + '</button>';
      }).join("");
      menu.hidden = false;
      menu.querySelectorAll("[data-sw]").forEach(function (b) {
        b.addEventListener("click", function () { menu.hidden = true; if (typeof opts.onExamSwitch === "function") opts.onExamSwitch(b.getAttribute("data-sw")); });
      });
    }
    else if (name === "passage") {
      if (!opts.silo) return;
      openPassageModal({
        title: "Choose a passage",
        groups: [{ label: sp.short + " mocks", items: opts.silo.map(function (t) {
          return { id: t.id, name: t.name, sub: (t.topic ? t.topic + " · " : "") + wordCountOf(t.text) + " words", diff: t.diff || null, done: false };
        }) }],
        onPick: function (item) {
          const t = opts.silo.find(function (x) { return x.id === item.id; });
          if (t) openExamTest(t);
        }
      });
    }
    else if (name === "backspace") {
      /* Custom mocks: the arena owns the override — it re-mounts with
         the flipped value so the pre-panel and badge stay truthful.
         Official mocks: flip the session-only override; the input-level
         guards (exCapture keydown/click) read bsEffective() live, and
         the badge/pill/pre-panel are repainted to match. */
      if (opts.custom) { if (typeof opts.onBackspaceToggle === "function") opts.onBackspaceToggle(!bsEffective()); }
      else { bsUser = !bsEffective(); paintBar(); paintBsChrome(); exFocus(); }
    }
    else if (name === "more") { morePop.hidden = !morePop.hidden; }
  }

  /* ---------- open / pre-panel (verbatim openExamTest) ---------- */
  function exFullTarget() {
    const base = EX.test.text;
    if (EX.spec.id !== "rrb") return base;
    const typed = (exCaptureEl.value || "");
    const reps = Math.max(1, Math.ceil((typed.length + 200) / base.length));
    let out = ""; for (let k = 0; k < reps; k++) out += (out ? " " : "") + base;
    return out;
  }
  function paintBsChrome() {
    q("#exBsState").textContent = "Backspace: " + (bsEffective() ? "Allowed" : "Disabled");
    q("#exNoBs").style.display = bsEffective() ? "none" : "";
    const pi = q("#exPreInfo");
    if (pi && EX.test) pi.textContent = sp.durationLabel + " · " + wordCountOf(EX.test.text) + " words · " + fmtNum(EX.test.text.length) + " keystrokes · Backspace " + (bsEffective() ? "allowed" : "DISABLED") + " · " + sp.evaluation + ".";
  }
  function openExamTest(t) {
    EX.test = t; EX.category = sp.categories ? sp.categories[0].id : ""; EX.started = false; EX.finished = false; EX.caret = 0;
    bsUser = null; /* (re)opening a test restarts the backspace rule at the exam default */
    clearInterval(EX.timer);
    TEL.setTarget(null, "typed");
    q("#exTitle").textContent = sp.name + " — " + t.name;
    q("#exCand").textContent = appState.user ? ((appState.accountName || "").trim() || appState.user.email || "Account") : "Practice candidate";
    q("#exBsState").textContent = "Backspace: " + (bsEffective() ? "Allowed" : "Disabled");
    q("#exNoBs").style.display = bsEffective() ? "none" : "";
    pill.paint(durMin * 60, durMin * 60); /* v23: full duration on the sticky pill from stage entry (pre-panel included) */
    q("#exPreTitle").textContent = t.name + " — before you start";
    q("#exPreInfo").textContent = sp.durationLabel + " · " + wordCountOf(t.text) + " words · " + fmtNum(t.text.length) + " keystrokes · Backspace " + (bsEffective() ? "allowed" : "DISABLED") + " · " + sp.evaluation + ".";
    const cw = q("#exCatWrap");
    if (sp.categories) {
      cw.innerHTML = "<strong>Your category:</strong> <span class='hint'>the verdict uses this cap.</span><div class='controls' style='margin-top:8px'>" + sp.categories.map(function (c) { return "<button class='pill exCat' data-cat='" + c.id + "' type='button'>" + c.label + " — error ≤ " + c.cap + "%</button>"; }).join("") + "</div>";
      cw.querySelectorAll(".exCat").forEach(function (b) { b.addEventListener("click", function () { EX.category = b.dataset.cat; paintExCats(); }); });
      paintExCats();
    } else cw.innerHTML = "";
    q("#exPrePanel").style.display = "block";
    q("#exStage").style.display = "none";
    q("#exResultBody").style.display = "none";
    q("#exPassage").textContent = t.text;
    exCaptureEl.value = "";
    q("#exTyped").innerHTML = "<span class='ph'>Click here and start typing the passage above…</span>";
    paintBar(); /* the reset above may have changed the backspace state the bar shows */
  }
  function paintExCats() { container.querySelectorAll(".exCat").forEach(function (b) { b.classList.toggle("active", b.dataset.cat === EX.category); }); }
  function exFocus() { try { exCaptureEl.focus({ preventScroll: true }); } catch (e) { exCaptureEl.focus(); } }
  function renderExTyped() {
    const disp = q("#exTyped");
    if (!disp) return;
    const v = exCaptureEl.value || "";
    if (!v) { disp.innerHTML = "<span class='ph'>Start typing…</span>"; return; }
    if (bsEffective()) {
      const c = Math.max(0, Math.min(EX.caret || 0, v.length));
      disp.innerHTML = escapeHtml(v.slice(0, c)) + "<span class='exCaret' aria-hidden='true'></span>" + escapeHtml(v.slice(c));
    } else {
      disp.textContent = v;
    }
  }
  function exCaretFromPoint(x, y) {
    const disp = q("#exTyped");
    if (!disp || !document.caretRangeFromPoint) return null;
    const r = document.caretRangeFromPoint(x, y);
    if (!r || !disp.contains(r.startContainer)) return null;
    let idx = 0; const node = r.startContainer;
    if (node === disp) {
      for (let i = 0; i < r.startOffset && i < disp.childNodes.length; i++) idx += (disp.childNodes[i].textContent || "").length;
      return idx;
    }
    let n = disp.firstChild;
    while (n && n !== node) { idx += (n.textContent || "").length; n = n.nextSibling; }
    if (!n) return null;
    return idx + r.startOffset;
  }

  q("#exStartBtn").addEventListener("click", function () {
    q("#exPrePanel").style.display = "none";
    q("#exStage").style.display = "block";
    exFocus();
  });
  q("#exTypedWrap").addEventListener("click", function (e) {
    exFocus();
    if (!bsEffective() || EX.finished) return;
    const len = (exCaptureEl.value || "").length;
    let idx = exCaretFromPoint(e.clientX, e.clientY);
    if (idx == null) idx = len;
    idx = Math.max(0, Math.min(idx, len));
    EX.caret = idx;
    try { exCaptureEl.setSelectionRange(idx, idx); } catch (err) {}
    renderExTyped();
  });
  q("#exBack").addEventListener("click", function () {
    if (EX.started && !EX.finished) {
      askConfirm("Leave this test?", "Your attempt will be cancelled and nothing will be saved.", function () { clearInterval(EX.timer); if (typeof opts.onBack === "function") opts.onBack(); }, function () { exFocus(); });
    } else if (typeof opts.onBack === "function") opts.onBack();
  });
  q("#exCancel").addEventListener("click", function () {
    askConfirm("Cancel this test?", "The attempt will be discarded — no result is saved.", function () { clearInterval(EX.timer); EX.finished = true; if (typeof opts.onBack === "function") opts.onBack(); }, function () { exFocus(); });
  });
  q("#exSubmit").addEventListener("click", function () {
    askConfirm("Submit this test?", "Your result will be calculated from the text now on screen.", function () { finishExamTest(); }, function () { if (EX.started && !EX.finished) exFocus(); });
  });

  exCaptureEl.addEventListener("keydown", function (e) {
    if (!bsEffective()) {
      if (e.key === "Backspace" || e.key === "Delete" || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Home" || e.key === "End" || e.ctrlKey || e.metaKey) { e.preventDefault(); return; }
    }
  });
  exCaptureEl.addEventListener("click", function () { if (!bsEffective()) { const c = exCaptureEl; try { c.setSelectionRange(c.value.length, c.value.length); } catch (e) {} } });
  exCaptureEl.addEventListener("keyup", function (e) {
    if (!bsEffective() || EX.finished) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Home" || e.key === "End") {
      const cs = exCaptureEl.selectionStart;
      if (cs != null) { EX.caret = cs; renderExTyped(); }
    }
  });
  exCaptureEl.addEventListener("input", function () {
    if (EX.finished) return;
    const v = exCaptureEl.value;
    TEL.feed(v);
    if (!EX.started && v.length > 0) startExTimer();
    if (soundOn()) keyClick();
    const csE = exCaptureEl.selectionStart;
    EX.caret = csE != null ? csE : v.length;
    renderExTyped();
    const pas = q("#exPassage");
    const tgt = exFullTarget(); pas.textContent = tgt;
    const prog = tgt.length ? v.length / tgt.length : 0;
    pas.scrollTop = Math.max(0, prog * (pas.scrollHeight - pas.clientHeight));
  });
  function startExTimer() {
    EX.started = true; EX.startT = Date.now();
    zen.enter();
    const total = durMin * 60;
    EX.timer = setInterval(function () {
      const el = (Date.now() - EX.startT) / 1000, left = Math.max(0, total - el);
      pill.paint(left, total);
      if (el >= total) finishExamTest();
    }, 200);
  }
  /* v23: the old updateExHud() is deleted, not just unwired — it only
     ever painted the removed mid-test stat cells (Net WPM, Error % /
     Allowance). Nothing stored or consumed its values; the result is
     computed from scratch in finishExamTest, unchanged. */

  /* ---------- finish (verbatim port of finishExamTest) ---------- */
  function mkEntry(o) {
    const t = EX.test;
    return { clientId: newClientId(), ts: new Date().toISOString(), d: new Date().toLocaleString("en-IN"), name: sp.short + " — " + t.name, part: sp.name, gross: o.gross, net: o.net, acc: o.acc, errs: o.errs, marks: 0, min: durMin, durSec: 0, chars: 0, words: 0, bs: 0, examMode: true, examId: sp.id, testId: t.id, category: EX.category || "", engine: sp.engine, full: 0, half: 0, errorPct: o.errorPct, verdict: o.verdict, errCat: { spelling: 0, capital: 0, punct: 0, spacing: 0, other: 0 }, weakKeys: {}, weakWords: {}, synced: false };
  }
  function finishExamTest() {
    if (EX.finished) return; EX.finished = true; clearInterval(EX.timer);
    zen.exit();
    pill.hide(); /* v23: the result screen replaces the pill */
    const t = EX.test;
    const typedText = exCaptureEl.value || "";
    let el = EX.started ? Math.min((Date.now() - EX.startT) / 1000, durMin * 60) : durMin * 60;
    if (el <= 0) el = durMin * 60;
    const mins = el / 60;
    const target = sp.id === "rrb" ? exFullTarget() : t.text;
    const sc = scoreWords(target, typedText, { countUntypedSkip: sp.engine === "E1" });
    const W5 = Math.round(typedText.length / 5);
    const gross = mins > 0 ? W5 / mins : 0;
    const weighted = sc.full + 0.5 * sc.half;
    let entry, result;
    if (sp.engine === "E1") {
      const errPct = W5 ? (weighted / W5 * 100) : 0;
      const cat = sp.categories.find(function (c) { return c.id === EX.category; }) || sp.categories[0];
      const netInd = gross;
      const qual = errPct <= cat.cap;
      const reason = qual ? "Error " + dispErrPct(errPct).toFixed(1) + "% is within the " + cat.cap + "% " + cat.label + " limit"
        : "Error " + dispErrPct(errPct).toFixed(1) + "% exceeds the " + cat.cap + "% " + cat.label + " limit";
      const acc = W5 ? Math.max(0, (W5 - weighted) / W5 * 100) : 100;
      entry = mkEntry({ gross: Math.round(gross), net: Math.round(netInd), acc: +acc.toFixed(1), errs: Math.round(weighted), errorPct: +errPct.toFixed(1), verdict: (qual ? "Qualified" : "Not qualified") + " — " + reason });
      result = { sp: sp, t: t, sc: sc, qual: qual, reason: reason, gross: gross, netInd: netInd, errPct: errPct, acc: acc, el: el, mins: mins, typedText: typedText, target: target, cat: cat, words5: W5 };
    } else {
      const allowance = W5 * 0.05;
      const finalM = Math.max(0, weighted - allowance);
      const net = mins > 0 ? Math.max(0, (W5 - finalM * 10) / mins) : 0;
      const qual2 = net >= 30;
      const reason2 = qual2 ? "Net speed " + net.toFixed(1) + " WPM meets the 30 WPM qualifying standard"
        : "Net speed " + net.toFixed(1) + " WPM is below the 30 WPM qualifying standard";
      const acc2 = W5 ? Math.max(0, (W5 - weighted) / W5 * 100) : 100;
      const errPct2 = W5 ? (weighted / W5 * 100) : 0;
      entry = mkEntry({ gross: Math.round(gross), net: Math.round(net), acc: +acc2.toFixed(1), errs: Math.round(weighted), errorPct: +errPct2.toFixed(1), verdict: (qual2 ? "Qualified" : "Not qualified") + " — " + reason2 });
      entry.finalMistakes = +finalM.toFixed(1); entry.allowance = +allowance.toFixed(1);
      result = { sp: sp, t: t, sc: sc, qual: qual2, reason: reason2, gross: gross, net: net, errPct: errPct2, acc: acc2, el: el, mins: mins, typedText: typedText, target: target, allowance: allowance, finalM: finalM, evaluated: true, words5: W5 };
    }
    entry.full = sc.full; entry.half = sc.half; entry.words = W5; entry.chars = typedText.length; entry.durSec = Math.round(el);
    entry.breakdown = { wrong: sc.wrong, skipped: sc.skipped, extra: sc.extra };
    (function () {
      const seen = {}, det = [];
      sc.detail.forEach(function (d) { if (d.kind === "extra" || !d.exp || d.tail) return; const k = d.exp + "" + d.got; if (seen[k]) return; seen[k] = 1; det.push({ exp: d.exp, got: d.got, st: (d.kind === "half" ? "half" : "full") }); });
      if (det.length) entry.mistakeDetail = det.slice(0, 60);
    })();
    result.entryClientId = entry.clientId;
    try {
      const fx = buildExamTelemetry(sp, target, typedText, sc);
      if (fx) {
        if (fx.tel) { entry.telemetry = fx.tel; result.tel = entry.telemetry; }
        revFeed(fx.feed, sp.id);
      }
    } catch (e) { console.warn("Telemetry failed", e); }
    try { if (entry.verdict == null || !/not qualified|DQ/i.test(String(entry.verdict))) celebrateIfBest(entry.net, loadHist(), sp.id); } catch (e) {}
    const h = loadHist(); h.unshift(entry); saveHist(h);
    if (appState.user) cloud.saveResult(entry);
    if (typeof opts.onFinish === "function") opts.onFinish(entry);

    q("#exStage").style.display = "none";
    q("#exPrePanel").style.display = "none";
    const resultEl = q("#exResultBody");
    resultEl.style.display = "block";
    renderExamResultInto(resultEl, result, {
      onBack: function () { if (typeof opts.onBack === "function") opts.onBack(); },
      onRetake: function () { openExamTest(t); },
      onPractise: function () { if (typeof opts.onPractiseMistakes === "function") opts.onPractiseMistakes(entry); },
      onProgress: function () { if (typeof opts.onProgress === "function") opts.onProgress(); }
    });
    /* Custom Tests (only) pause on the motivation overlay before the
       result — hub mocks in this engine go straight to their result. */
    const isCustomRun = !!(t && typeof t.id === "string" && t.id.indexOf("custom-") === 0);
    if (isCustomRun) {
      resultEl.classList.add("motivHold");
      showMotivation(!!result.qual, function () { resultEl.classList.remove("motivHold"); });
    }
  }

  paintBar();
  applyExTypeFont();
  openExamTest(EX.test);

  return {
    destroy: function () { clearInterval(EX.timer); zen.destroy(); more.destroy(); pill.destroy(); },
    _ex: EX,
    finishNow: finishExamTest
  };
}

/* Stage 3's Training Studio mounts its practice contexts through the same
   HCM stage (ctx:"practice"); the alias keeps the Stage 1 contract name. */
export function mountPracticeStage(container, opts) {
  return mountHcmStage(container, Object.assign({}, opts, { ctx: "practice" }));
}
