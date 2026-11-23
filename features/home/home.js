/* features/home — Landing (prompt §3): hero + active-exam badge, two CTAs,
   dynamic Exam Marks Slab Bar for the active exam, Best & Streak strip
   (computed from the EXISTING history keys with the current formulas),
   quick-launch cards. No explainer paragraphs — micro-labels only. */

import { specOf, testsOf } from "../../data/exams.js";
import { FLAT_TEXTS } from "../../data/drills.js";
import { WARMUPS } from "../../data/warmups.js";
import { NCRTC_MANIFEST } from "../../data/ncrtcManifest.js";
import { slabFor } from "../../core/scoringMatrix.js";
import { dashboardStats, currentStreak } from "../../core/stats.js";
import { appState, on } from "../../core/state.js";
import { icon } from "../../components/icons.js";
import { escapeHtml, displayNameForUI } from "../../components/ProfilePopover.js";

function timeOfDayGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
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

export function mount(container) {
  const unsubs = [];
  function render() {
    const sp = specOf(appState.activeExam);
    const stats = dashboardStats(FLAT_TEXTS.length);
    const streak = currentStreak();
    const name = displayNameForUI();
    const greet = appState.user ? timeOfDayGreeting() + (name ? ", " + name : "") : "Free practice · No sign-up needed";
    container.innerHTML =
      '<section class="hero">' +
        '<div class="hero-greet">' + escapeHtml(greet) + '</div>' +
        '<span class="badge info hero-badge">' + icon("target") + ' ' + escapeHtml(sp.name) + ' · ' + escapeHtml(sp.durationLabel) + '</span>' +
        '<h1>Type like it\'s <span class="grad">exam day</span>.</h1>' +
        '<p class="hero-sub">Exam-pattern typing tests for Delhi Police HCM, SSC CHSL, SSC CGL DEST and RRB NTPC — each scored exactly the way its exam is.</p>' +
        '<div class="hero-ctas">' +
          '<a class="btn" href="#/arena">' + icon("arena") + 'Start Exam Mock</a>' +
          '<a class="btn secondary" href="#/studio">' + icon("keyboard") + 'Open Training Studio</a>' +
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
        '<div class="stat-cell"><span class="sv">' + stats.drillsPassed + ' / ' + stats.totalTexts + '</span><span class="sl">Drills passed · 98% gate</span></div>' +
      '</section>' +

      '<section aria-label="Quick launch">' +
        '<h2>Jump back in</h2>' +
        '<div class="quick-grid">' +
          '<a class="quick-card" href="#/arena"><h3>' + icon("arena") + 'Exam Arena</h3><p>Official mocks + custom mocks for the active exam.</p>' +
            '<span class="qc-meta"><span class="pillStat">' + testsOf(sp.id).length + ' ' + escapeHtml(sp.short) + ' mocks</span><span class="pillStat">' + escapeHtml(sp.durationLabel) + '</span></span></a>' +
          '<a class="quick-card" href="#/studio"><h3>' + icon("keyboard") + 'Training Studio</h3><p>Warm-ups, skill drills and themed practice.</p>' +
            '<span class="qc-meta"><span class="pillStat">' + WARMUPS.length + ' warm-up sets</span><span class="pillStat">76 drills</span></span></a>' +
          '<a class="quick-card" href="#/progress"><h3>' + icon("chart") + 'Progress</h3><p>Trends, history and your weakest keys.</p>' +
            '<span class="qc-meta"><span class="pillStat">' + stats.tests + ' results saved</span></span></a>' +
          '<a class="quick-card" href="#/ncrtc"><h3>' + icon("file") + 'NCRTC Mocks</h3><p>Supervisor-I (Operations) D01 MCQ tests.</p>' +
            '<span class="qc-meta"><span class="pillStat">' + NCRTC_MANIFEST.tests.length + ' tests</span><span class="pillStat">2,040 questions</span></span></a>' +
        '</div>' +
      '</section>';
  }
  render();
  unsubs.push(on("exam", render), on("auth", render), on("data", render));
  return { destroy: function () { unsubs.forEach(function (u) { u(); }); } };
}
