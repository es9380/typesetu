/* features/home — Landing v13.
   - Hero with a LIVE mini typing demo (nothing is saved; it is a taster).
   - Today strip: exam readiness ring + daily-goal ring (tap to change goal).
   - Marks slab for the active exam, best/streak strip, quick-launch cards.
   PERFORMANCE: this view must NOT import data/drills.js, warmups.js or the
   NCRTC manifest (≈850 KB). Counts come from data/counts.js instead. */

import { specOf, testsOf } from "../../data/exams.js";
import { COUNTS } from "../../data/counts.js";
import { slabFor } from "../../core/scoringMatrix.js";
import {
  dashboardStats, currentStreak, testsToday, getDailyGoal, setDailyGoal, readiness, topWeakKeys
} from "../../core/stats.js";
import { appState, on } from "../../core/state.js";
import { icon } from "../../components/icons.js";
import { escapeHtml, displayNameForUI } from "../../components/ProfilePopover.js";

const DEMO_LINES = [
  "The office opens at nine and the files must be ready by ten.",
  "Practice every day because speed follows accuracy, not the other way round.",
  "Please submit the application before the last date to avoid rejection.",
  "A steady rhythm beats a fast start and a slow finish every single time.",
  "The candidate must type the passage exactly as it is printed on the sheet."
];

function timeOfDayGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function ring(pct, label, sub, cls) {
  const R = 34, C = 2 * Math.PI * R, off = C * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return '<div class="tring ' + (cls || "") + '">' +
    '<svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true">' +
      '<circle class="tr-bg" cx="40" cy="40" r="' + R + '"/>' +
      '<circle class="tr-fg" cx="40" cy="40" r="' + R + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 40 40)"/>' +
    '</svg><span class="tr-label">' + label + '</span></div>' +
    '<div class="tr-sub">' + sub + '</div>';
}

function slabHtml(examId) {
  const s = slabFor(examId);
  if (!s) return "";
  if (s.kind === "marks") {
    return '<div class="slab-bar">' + s.segments.map(function (seg) {
      return '<div class="slab-seg ' + seg.kind + '"><span class="ss-marks">' + (seg.kind === "dq" ? "DQ" : seg.marks) + '</span><span class="ss-range">' + seg.range + ' WPM</span></div>';
    }).join("") + '</div><p class="slab-note">' + escapeHtml(s.note) + '</p>';
  }
  if (s.kind === "pass") {
    return '<div class="slab-single">' + icon("target") + '<span>' + escapeHtml(s.headline) + '</span></div><p class="slab-note">' + escapeHtml(s.note) + '</p>';
  }
  return s.groups.map(function (g) {
    return '<div class="slab-bar">' + g.categories.map(function (c) {
      return '<div class="slab-seg"><span class="ss-marks">≤ ' + c.cap + '%</span><span class="ss-range">' + escapeHtml(c.label) + ' errors</span></div>';
    }).join("") + '</div><p class="slab-note">' + escapeHtml(g.title) + '</p>';
  }).join("") + '<p class="slab-note">' + escapeHtml(s.note) + '</p>';
}

/* ---- live demo: self-contained, saves nothing ---- */
function mountDemo(root) {
  const box = root.querySelector("#demoBox");
  if (!box) return function () {};
  const textEl = root.querySelector("#demoText"), hud = root.querySelector("#demoHud"), done = root.querySelector("#demoDone");
  let target = "", typed = "", t0 = 0, finished = false, spans = [], mistakes = 0, tick = null;

  function pick() { return DEMO_LINES[Math.floor(Math.random() * DEMO_LINES.length)]; }
  function build() {
    target = pick(); typed = ""; t0 = 0; finished = false; mistakes = 0;
    clearInterval(tick); tick = null;
    textEl.innerHTML = target.split("").map(function (c) { return "<span>" + (c === " " ? "&nbsp;" : escapeHtml(c)) + "</span>"; }).join("");
    spans = Array.prototype.slice.call(textEl.children);
    spans[0].classList.add("cur");
    done.hidden = true; hud.hidden = false; box.classList.remove("finished");
    paintHud();
  }
  function stats() {
    const mins = t0 ? Math.max((Date.now() - t0) / 60000, 1 / 600) : 0;
    let ok = 0; for (let i = 0; i < typed.length; i++) if (typed[i] === target[i]) ok++;
    return {
      wpm: mins ? Math.round((ok / 5) / mins) : 0,
      acc: typed.length ? Math.round(ok / typed.length * 100) : 100
    };
  }
  function paintHud() {
    const s = stats();
    hud.innerHTML = '<span><b>' + s.wpm + '</b> WPM</span><span><b>' + s.acc + '%</b> accuracy</span>';
  }
  function finish() {
    finished = true; clearInterval(tick); tick = null;
    const s = stats();
    box.classList.add("finished"); hud.hidden = true; done.hidden = false;
    done.querySelector("#demoRes").innerHTML = '<b>' + s.wpm + ' WPM</b> · ' + s.acc + '% accuracy';
  }
  function paintChar(i) {
    const sp = spans[i]; if (!sp) return;
    sp.classList.remove("ok", "bad", "cur");
    if (i < typed.length) sp.classList.add(typed[i] === target[i] ? "ok" : "bad");
  }
  function onKey(e) {
    if (finished) { if (e.key === "Enter") { e.preventDefault(); build(); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      if (typed.length) { typed = typed.slice(0, -1); paintChar(typed.length); }
    } else if (e.key.length === 1) {
      e.preventDefault();
      if (!t0) { t0 = Date.now(); tick = setInterval(paintHud, 400); }
      if (typed.length < target.length) { typed += e.key; paintChar(typed.length - 1); }
      if (typed.length >= target.length) { finish(); return; }
    } else return;
    spans.forEach(function (s) { s.classList.remove("cur"); });
    if (spans[typed.length]) spans[typed.length].classList.add("cur");
    paintHud();
  }
  box.addEventListener("keydown", onKey);
  box.addEventListener("click", function () { box.focus(); });
  root.querySelector("#demoAgain").addEventListener("click", function () { build(); box.focus(); });
  build();
  return function () { clearInterval(tick); box.removeEventListener("keydown", onKey); };
}

export function mount(container) {
  const unsubs = [];
  let stopDemo = function () {};

  function render() {
    stopDemo();
    const sp = specOf(appState.activeExam);
    const stats = dashboardStats(COUNTS.texts);
    const streak = currentStreak();
    const name = displayNameForUI();
    const greet = appState.user ? timeOfDayGreeting() + (name ? ", " + name : "") : "Free practice · No sign-up needed";
    const goal = getDailyGoal(), today = testsToday();
    const rd = readiness(sp.id, sp.targetWPM);
    const weak = topWeakKeys(3);

    const readyCard = rd
      ? ring(rd.pct, rd.pct + "%", "Ready for " + escapeHtml(sp.short) + "<small>avg " + rd.avgNet + " net WPM · last " + rd.n + " test" + (rd.n > 1 ? "s" : "") + "</small>", "ready")
      : ring(0, "—", "Readiness for " + escapeHtml(sp.short) + "<small>Take one " + escapeHtml(sp.short) + " mock to unlock</small>", "ready");
    const goalCard = ring(Math.min(100, today / goal * 100), today + "/" + goal,
      (today >= goal ? "Daily goal done " : "Today’s goal ") + (today >= goal ? "✓" : "") + '<small><button type="button" class="linkbtn" id="goalBtn">Change goal</button></small>', today >= goal ? "goal done" : "goal");

    container.innerHTML =
      '<section class="hero">' +
        '<div class="hero-greet">' + escapeHtml(greet) + '</div>' +
        '<span class="badge info hero-badge">' + icon("target") + ' ' + escapeHtml(sp.name) + ' · ' + escapeHtml(sp.durationLabel) + '</span>' +
        '<h1>Type like it\'s <span class="grad">exam day</span>.</h1>' +
        '<p class="hero-sub">Exam-pattern typing tests for Delhi Police HCM, SSC CHSL, SSC CGL DEST and RRB NTPC — each scored exactly the way its exam is.</p>' +
        '<div class="demo" id="demo">' +
          '<div class="demo-top"><span class="demo-tag">Try it — no sign-up</span><span class="demo-hud" id="demoHud"></span></div>' +
          '<div class="demo-box" id="demoBox" tabindex="0" role="textbox" aria-label="Typing demo. Click and start typing.">' +
            '<div class="demo-text" id="demoText"></div>' +
            '<div class="demo-hint">Click here and start typing</div>' +
          '</div>' +
          '<div class="demo-done" id="demoDone" hidden><span id="demoRes"></span>' +
            '<span class="demo-actions"><button class="btn sm secondary" type="button" id="demoAgain">Try another line</button>' +
            '<a class="btn sm" href="#/arena">Take a full exam mock →</a></span></div>' +
        '</div>' +
        '<div class="hero-ctas">' +
          '<a class="btn" href="#/arena">' + icon("arena") + 'Start Exam Mock</a>' +
          '<a class="btn secondary" href="#/studio">' + icon("keyboard") + 'Open Training Studio</a>' +
        '</div>' +
      '</section>' +

      '<section class="today-strip" aria-label="Today">' +
        '<div class="card today-card">' + readyCard + '</div>' +
        '<div class="card today-card">' + goalCard + '</div>' +
        '<div class="card today-card today-next">' +
          '<h3>' + icon("flame") + ' Next best step</h3>' +
          (weak.length
            ? '<p class="muted">Your weakest keys lately: ' + weak.map(function (k) { return '<kbd>' + escapeHtml(k === " " ? "space" : k) + '</kbd>'; }).join(" ") + '</p><a class="btn sm" href="#/studio">Drill them in Training Studio</a>'
            : '<p class="muted">Take a mock and we will find the keys that cost you the most marks.</p><a class="btn sm" href="#/arena">Take your first mock</a>') +
        '</div>' +
      '</section>' +

      '<section class="card slab-card" aria-label="Marks slab for the active exam">' +
        '<div class="slab-head"><h2>' + escapeHtml(sp.short) + ' — how scoring works</h2>' +
        '<span class="pillStat">' + escapeHtml(sp.targetLabel) + '</span></div>' +
        slabHtml(sp.id) +
      '</section>' +

      '<section class="stat-strip" aria-label="Your best and streak">' +
        '<div class="stat-cell"><span class="sv">' + (stats.bestNet != null ? stats.bestNet + " WPM" : "—") + '</span><span class="sl">Best net speed</span></div>' +
        '<div class="stat-cell"><span class="sv">' + streak + (streak === 1 ? " day" : " days") + '</span><span class="sl">Practice streak</span></div>' +
        '<div class="stat-cell"><span class="sv">' + stats.tests + '</span><span class="sl">Tests taken</span></div>' +
        '<div class="stat-cell"><span class="sv">' + stats.drillsPassed + ' / ' + COUNTS.texts + '</span><span class="sl">Drills passed · 98% gate</span></div>' +
      '</section>' +

      '<section aria-label="Quick launch">' +
        '<h2>Jump back in</h2>' +
        '<div class="quick-grid">' +
          '<a class="quick-card" href="#/arena"><h3>' + icon("arena") + 'Exam Arena</h3><p>Official mocks + custom mocks for the active exam.</p>' +
            '<span class="qc-meta"><span class="pillStat">' + testsOf(sp.id).length + ' ' + escapeHtml(sp.short) + ' mocks</span><span class="pillStat">' + escapeHtml(sp.durationLabel) + '</span></span></a>' +
          '<a class="quick-card" href="#/studio"><h3>' + icon("keyboard") + 'Training Studio</h3><p>Warm-ups, skill drills and themed practice.</p>' +
            '<span class="qc-meta"><span class="pillStat">' + COUNTS.warmups + ' warm-up sets</span><span class="pillStat">' + COUNTS.drills + ' drills</span></span></a>' +
          '<a class="quick-card" href="#/progress"><h3>' + icon("chart") + 'Progress</h3><p>Trends, history and your weakest keys.</p>' +
            '<span class="qc-meta"><span class="pillStat">' + stats.tests + ' results saved</span></span></a>' +
          '<a class="quick-card" href="#/ncrtc"><h3>' + icon("file") + 'NCRTC Mocks</h3><p>Supervisor-I (Operations) D01 MCQ tests.</p>' +
            '<span class="qc-meta"><span class="pillStat">' + COUNTS.ncrtcTests + ' tests</span><span class="pillStat">' + COUNTS.ncrtcQuestions.toLocaleString("en-IN") + ' questions</span></span></a>' +
        '</div>' +
      '</section>';

    stopDemo = mountDemo(container);
    const gb = container.querySelector("#goalBtn");
    if (gb) gb.addEventListener("click", function () {
      const opts = [1, 2, 3, 5, 8], i = opts.indexOf(getDailyGoal());
      setDailyGoal(opts[(i + 1) % opts.length]); render();
    });
  }
  render();
  unsubs.push(on("exam", render), on("auth", render), on("data", render));
  return { destroy: function () { stopDemo(); unsubs.forEach(function (u) { u(); }); } };
}
