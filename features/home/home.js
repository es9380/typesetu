/* features/home — Landing v13.
   - Hero with a LIVE mini typing demo (nothing is saved; it is a taster).
   - Today strip: exam readiness ring + daily-goal ring (tap to change goal).
   - Marks slab for the active exam, best/streak strip, quick-launch cards.
   PERFORMANCE: this view must NOT import data/drills.js, warmups.js or the
   NCRTC manifest (≈850 KB). Counts come from data/counts.js instead. */

import { specOf } from "../../data/examSpecs.js";
import { COUNTS } from "../../data/counts.js";
import { artHtml, mountHeroArt } from "./heroArt.js";
import { slabFor } from "../../core/scoringMatrix.js";
import {
  dashboardStats, currentStreak, testsToday, getDailyGoal, setDailyGoal, readiness, topWeakKeys, typingTimeByDay
} from "../../core/stats.js";
import { appState, on } from "../../core/state.js";
import { icon } from "../../components/icons.js";
import { escapeHtml, displayNameForUI } from "../../components/ProfilePopover.js";

const DEMO_LINES = [
  "Accuracy first, speed will follow.",
  "Keep your eyes on the text and relax.",
  "Small daily practice builds big speed.",
  "Breathe, focus and let the rhythm flow.",
  "Every correct word brings you closer to the cutoff.",
  "The office opens at nine and the files must be ready by ten.",
  "Please submit the application before the last date to avoid rejection.",
  "A steady rhythm beats a fast start and a slow finish every single time.",
  "Practice every day, because speed follows accuracy and accuracy follows patience.",
  "The candidate must type the passage exactly as it is printed on the answer sheet.",
  "Every mistake in the examination hall costs marks, so accuracy always comes first.",
  "Keep your eyes on the text, your hands on the home row and your mind on the clock.",
  "Good typists are not born, they are built one calm and careful session at a time.",
  "The department has issued fresh instructions regarding the disposal of pending files."
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

/* "42 min" under an hour, then "1 h 12 min" (or a clean "1 h"). */
function fmtTypeTime(sec) {
  const m = Math.round((+sec || 0) / 60);
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60), r = m % 60;
  return r ? h + " h " + r + " min" : h + " h";
}

/* Daily typing-time card (v16): today's total across ALL saved sessions
   (mocks, custom tests, drills, warm-ups, passages, revision) plus a
   last-7-days bar strip. Read-only over local history. */
function typingTimeCard() {
  const days = typingTimeByDay(7);
  const todaySec = days[days.length - 1].seconds;
  const maxSec = Math.max.apply(null, days.map(function (d) { return d.seconds; }).concat([1]));
  const bars = days.map(function (d, i) {
    const pct = Math.round(d.seconds / maxSec * 100);
    const h = d.seconds > 0 ? Math.max(10, pct) : 3;
    return '<span class="tt-col' + (i === days.length - 1 ? " today" : "") + '">' +
      '<span class="tt-track"><span class="tt-fill" style="height:' + h + '%"></span></span>' +
      '<i>' + "SMTWTFS"[d.date.getDay()] + '</i></span>';
  }).join("");
  return '<div class="tt-main"><span class="tt-big">' + fmtTypeTime(todaySec) + '</span>' +
    '<span class="tt-sub">' + (todaySec > 0 ? "Typing time today" : "No typing yet today") + '</span></div>' +
    '<div class="tt-bars" role="img" aria-label="Typing time for the last 7 days">' + bars + '</div>';
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

/* ---- live demo v2: human-like auto-typist until the visitor takes over.
   Self-contained, saves nothing. hooks.onKey(char, ok) fires for every
   simulated or real key (the hero keyboard art flashes in sync). ---- */
const NEAR = { q:"wa", w:"qes", e:"wrd", r:"etf", t:"ryg", y:"tuh", u:"yij", i:"uok", o:"ipl", p:"ol",
  a:"qsz", s:"awdx", d:"sefc", f:"drgv", g:"fthb", h:"gyjn", j:"hukm", k:"jil", l:"kop",
  z:"asx", x:"zsc", c:"xdv", v:"cfb", b:"vgn", n:"bhm", m:"nj" };

function mountDemo(root, hooks) {
  hooks = hooks || {};
  const box = root.querySelector("#demoBox"); if (!box) return function () {};
  const textEl = root.querySelector("#demoText"), hud = root.querySelector("#demoHud"),
        done = root.querySelector("#demoDone"), tag = root.querySelector("#demoTag");
  const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  let mode = "auto", target = "", typed = "", spans = [], cur = 0;
  let t0 = 0, total = 0, wrong = 0, finished = false, lastLine = -1;
  let runId = 0, timer = 0, wake = null, running = false, hudTimer = 0, idleTimer = 0, visible = true;

  /* ---- line + painting ---- */
  function maxChars() {
    const fs = parseFloat(getComputedStyle(textEl).fontSize) || 18;
    const inner = textEl.clientWidth || (box.clientWidth - 32);
    return Math.max(28, Math.floor(Math.floor(inner / (fs * 0.6)) * 2 * 0.86)); // 0.86 = word-wrap slack
  }
  function pickLine() {
    const max = maxChars();
    let pool = [];
    DEMO_LINES.forEach(function (s, i) { if (s.length <= max && i !== lastLine) pool.push(i); });
    if (!pool.length) { // nothing fits: take the shortest
      pool = [DEMO_LINES.reduce(function (m, s, i) { return s.length < DEMO_LINES[m].length ? i : m; }, 0)];
    }
    lastLine = pool[Math.floor(Math.random() * pool.length)];
    return DEMO_LINES[lastLine];
  }
  function loadLine() {
    target = pickLine(); typed = ""; t0 = 0; total = 0; wrong = 0; finished = false;
    textEl.innerHTML = target.split(" ").map(function (w) {
      return '<span class="w">' + w.split("").map(function (c) { return "<span>" + escapeHtml(c) + "</span>"; }).join("") + "</span>";
    }).join('<span class="sp"> </span>');
    spans = Array.prototype.slice.call(textEl.querySelectorAll(".w > span, .sp"));
    cur = 0; spans[0].classList.add("cur");
    done.hidden = true; hud.hidden = false; box.classList.remove("finished", "fading");
    paintHud();
  }
  function paintChar(i) {
    const sp = spans[i]; if (!sp) return;
    sp.classList.remove("ok", "bad");
    if (i < typed.length) sp.classList.add(typed[i] === target[i] ? "ok" : "bad");
  }
  function moveCaret() {
    if (spans[cur]) spans[cur].classList.remove("cur");
    cur = typed.length;
    if (spans[cur]) spans[cur].classList.add("cur");
  }
  function stats() {
    let ok = 0; for (let i = 0; i < typed.length; i++) if (typed[i] === target[i]) ok++;
    const mins = t0 ? Math.max((Date.now() - t0) / 60000, 1 / 600) : 0;
    /* accuracy counts EVERY wrong keystroke, even ones later fixed (honest, and never a fake 100%) */
    return { wpm: mins ? Math.round((ok / 5) / mins) : 0, acc: total ? Math.round((total - wrong) / total * 100) : 100 };
  }
  function paintHud() {
    const s = stats();
    hud.innerHTML = '<span><b>' + s.wpm + '</b> WPM</span><span><b>' + s.acc + '%</b> accuracy</span>';
  }

  /* ---- keystrokes (shared by the auto-typist and the real user) ---- */
  function press(c) {
    if (!t0) t0 = Date.now();
    typed += c; total++;
    const ok = c === target[typed.length - 1];
    if (!ok) wrong++;
    paintChar(typed.length - 1); moveCaret();
    if (hooks.onKey) hooks.onKey(c, ok);
  }
  function back() {
    if (!typed.length) return;
    typed = typed.slice(0, -1); paintChar(typed.length); moveCaret();
    if (hooks.onKey) hooks.onKey("Backspace", true);
  }

  /* ---- cancellable sleep ---- */
  function sleep(ms) {
    return new Promise(function (res) { wake = res; timer = setTimeout(function () { wake = null; res(true); }, ms); });
  }
  function cancelAuto() {
    runId++; clearTimeout(timer);
    if (wake) { const w = wake; wake = null; w(false); }
    running = false;
  }

  /* ---- the human-like auto-typist ---- */
  function delay(ch) {
    let d = 90 + Math.random() * 90;                       // ≈ 70 net WPM feel
    if (ch === " ") d += 30 + Math.random() * 60;          // tiny pause between words
    else if (ch === "." || ch === ",") d += 140;           // pause at punctuation
    if (Math.random() < 0.03) d += 260;                    // rare hesitation
    return d;
  }
  function nearKey(ch) {
    const lo = ch.toLowerCase(), n = NEAR[lo]; if (!n) return null;   // only letters can be mistyped
    const w = n[Math.floor(Math.random() * n.length)];
    return ch === lo ? w : w.toUpperCase();
  }
  async function autoLoop() {
    const me = ++runId; running = true;
    const alive = function () { return me === runId; };
    while (alive()) {
      loadLine();
      if (!(await sleep(800))) return;
      let i = 0, calm = 2;                                  // calm = chars with no mistakes allowed
      while (i < target.length) {
        const ch = target[i];
        const bad = (calm > 0 || typed.length !== i) ? null : (Math.random() < 0.05 ? nearKey(ch) : null);
        if (calm > 0) calm--;
        if (!bad) { press(ch); i++; if (!(await sleep(delay(ch)))) return; continue; }
        press(bad);                                         // a wrong neighbour key
        if (!(await sleep(delay(ch)))) return;
        if (Math.random() < 0.7) {                          // 70%: notice it and fix it
          const extra = Math.min(Math.floor(Math.random() * 3), target.length - i - 1); // 0–2 more chars first
          for (let k = 1; k <= extra; k++) { press(target[i + k]); if (!(await sleep(delay(target[i + k])))) return; }
          if (!(await sleep(160 + Math.random() * 200))) return;       // the "oh no" pause
          for (let k = 0; k <= extra; k++) { back(); if (!(await sleep(70 + Math.random() * 40))) return; }
          calm = 3;                                         // i unchanged → retype this char correctly
        } else { i++; }                                     // 30%: leave the red mistake in the text
      }
      finished = true; paintHud();
      if (!(await sleep(1700))) return;                     // admire the result
      box.classList.add("fading");                          // CSS fades text out (.35s)
      if (!(await sleep(380))) return;
    }
  }

  /* ---- modes ---- */
  function sync() {  // single place that starts/stops the auto-typist
    const go = mode === "auto" && visible && !document.hidden && !reduce;
    if (go && !running) autoLoop(); else if (!go && running) cancelAuto();
  }
  function toUser() {
    if (mode === "user") return;
    mode = "user"; cancelAuto(); clearTimeout(idleTimer);
    box.dataset.mode = "user"; tag.textContent = "Your turn"; loadLine();
  }
  function toAuto() {
    if (mode === "auto") return;
    mode = "auto"; box.dataset.mode = "auto"; tag.textContent = "Live demo"; done.hidden = true; sync();
  }
  function finishUser() {
    finished = true; const s = stats();
    box.classList.add("finished"); hud.hidden = true; done.hidden = false;
    done.querySelector("#demoRes").innerHTML = "<b>" + s.wpm + " WPM</b> · " + s.acc + "% accuracy";
  }
  function onKey(e) {
    if (mode !== "user") return;
    if (finished) { if (e.key === "Enter") { e.preventDefault(); loadLine(); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace") { e.preventDefault(); back(); }
    else if (e.key.length === 1) {
      e.preventDefault();
      if (typed.length < target.length) press(e.key);
      if (typed.length >= target.length) { finishUser(); return; }
    } else return;
    paintHud();
  }

  box.addEventListener("pointerdown", toUser);                     // a click takes over
  box.addEventListener("focus", function () { clearTimeout(idleTimer); toUser(); });
  box.addEventListener("blur", function () { if (mode === "user") idleTimer = setTimeout(toAuto, 12000); }); // idle 12 s → auto again
  box.addEventListener("keydown", onKey);
  root.querySelector("#demoAgain").addEventListener("click", function () { loadLine(); box.focus(); });

  const io = "IntersectionObserver" in window
    ? new IntersectionObserver(function (es) { visible = es[0].isIntersecting; sync(); }, { threshold: 0.2 }) : null;
  if (io) io.observe(box);
  document.addEventListener("visibilitychange", sync);
  hudTimer = setInterval(function () { if (!finished) paintHud(); }, 400);

  if (reduce) loadLine(); // reduced motion: show a static line, no auto typing
  sync();

  return function destroy() {
    cancelAuto(); clearInterval(hudTimer); clearTimeout(idleTimer);
    if (io) io.disconnect(); document.removeEventListener("visibilitychange", sync);
  };
}

export function mount(container) {
  const unsubs = [];
  let stopDemo = function () {}, art = { hit: function () {}, destroy: function () {} };

  function render() {
    stopDemo(); art.destroy();
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
      '<section class="hero hero-grid">' +
        '<div class="hero-main">' +
        '<div class="hero-greet">' + escapeHtml(greet) + '</div>' +
        '<span class="badge info hero-badge">' + icon("target") + ' ' + escapeHtml(sp.name) + ' · ' + escapeHtml(sp.durationLabel) + '</span>' +
        '<h1>Type like it\'s <span class="grad">exam day</span>.</h1>' +
        '<p class="hero-sub">Exam-pattern typing tests for Delhi Police HCM, SSC CHSL, SSC CGL DEST and RRB NTPC — each scored exactly the way its exam is.</p>' +
        '<div class="demo" id="demo">' +
          '<div class="demo-top">' +
            '<span class="demo-tag" id="demoTag">Live demo</span>' +
            '<span class="demo-hud" id="demoHud"></span>' +
          '</div>' +
          '<div class="demo-box" id="demoBox" data-mode="auto" tabindex="0" role="textbox" aria-label="Typing demo. Click and start typing.">' +
            '<div class="demo-text" id="demoText"></div>' +
            '<div class="demo-hint">Click to type it yourself</div>' +
          '</div>' +
          '<div class="demo-done" id="demoDone" hidden>' +
            '<span id="demoRes"></span>' +
            '<span class="demo-actions">' +
              '<button class="btn sm secondary" type="button" id="demoAgain">Try another line</button>' +
              '<a class="btn sm" href="#/arena">Take a full exam mock →</a>' +
            '</span>' +
          '</div>' +
        '</div>' +
        '<div class="hero-ctas">' +
          '<a class="btn" href="#/arena">' + icon("arena") + 'Start Exam Mock</a>' +
          '<a class="btn secondary" href="#/studio">' + icon("keyboard") + 'Open Training Studio</a>' +
        '</div>' +
        '</div>' +
        '<div class="hero-art" id="heroArt" aria-hidden="true">' + artHtml() + '</div>' +
      '</section>' +

      '<section class="today-strip" aria-label="Today">' +
        '<div class="card today-card">' + readyCard + '</div>' +
        '<div class="card today-card">' + goalCard + '</div>' +
        '<div class="card today-card today-time">' + typingTimeCard() + '</div>' +
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
            '<span class="qc-meta"><span class="pillStat">' + COUNTS.mocks[sp.id] + ' ' + escapeHtml(sp.short) + ' mocks</span><span class="pillStat">' + escapeHtml(sp.durationLabel) + '</span></span></a>' +
          '<a class="quick-card" href="#/studio"><h3>' + icon("keyboard") + 'Training Studio</h3><p>Warm-ups, skill drills and themed practice.</p>' +
            '<span class="qc-meta"><span class="pillStat">' + COUNTS.warmups + ' warm-up sets</span><span class="pillStat">' + COUNTS.drills + ' drills</span></span></a>' +
          '<a class="quick-card" href="#/progress"><h3>' + icon("chart") + 'Progress</h3><p>Trends, history and your weakest keys.</p>' +
            '<span class="qc-meta"><span class="pillStat">' + stats.tests + ' results saved</span></span></a>' +
          '<a class="quick-card" href="#/ncrtc"><h3>' + icon("file") + 'NCRTC Mocks</h3><p>Supervisor-I (Operations) D01 MCQ tests.</p>' +
            '<span class="qc-meta"><span class="pillStat">' + COUNTS.ncrtcTests + ' tests</span><span class="pillStat">' + COUNTS.ncrtcQuestions.toLocaleString("en-IN") + ' questions</span></span></a>' +
        '</div>' +
      '</section>';

    art = mountHeroArt(container);
    stopDemo = mountDemo(container, { onKey: art.hit });
    const gb = container.querySelector("#goalBtn");
    if (gb) gb.addEventListener("click", function () {
      const opts = [1, 2, 3, 5, 8], i = opts.indexOf(getDailyGoal());
      setDailyGoal(opts[(i + 1) % opts.length]); render();
    });
  }
  render();
  unsubs.push(on("exam", render), on("auth", render), on("data", render));
  return { destroy: function () { stopDemo(); art.destroy(); unsubs.forEach(function (u) { u(); }); } };
}
