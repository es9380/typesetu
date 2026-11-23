/* features/examArena — Exam Arena (Stage 2).
   Arena home (4 official hub cards + Custom Mocks), per-exam hub lists
   (positional names, difficulty groups, "New" tags, completion from BOTH
   legacy mechanisms — HCM lesson machinery, SSC history-by-testId), the
   typing stages (core/examEngine.js), stored results and the Result Card.
   Copy stays minimal (declutter rule); pattern facts come from
   EXAM_SPECS — the same source the doorway pages mirror. */

import { EXAM_SPECS, specOf, testsOf, fmtNum } from "../../data/exams.js";
import { lessonStatus, attemptedEntry } from "../../core/storage.js";
import { wordCountOf } from "../../core/scoringMatrix.js";
import { setActiveExam } from "../../core/state.js";
import { mountHcmStage, mountExamStage } from "../../core/examEngine.js";
import {
  renderStoredExamResultInto, renderStoredHcmResultInto, hcmEntryForTest
} from "./resultView.js";
import { icon } from "../../components/icons.js";
import { escapeHtml } from "../../components/ProfilePopover.js";
import { setPendingMistakeEntry } from "../progress/revision.js";

function attemptedCount(examId) {
  if (examId === "hcm") {
    return testsOf("hcm").filter(function (t) { return lessonStatus(t.id).completed; }).length;
  }
  return testsOf(examId).filter(function (t) { return !!attemptedEntry(t.id); }).length;
}
function diffLabel(d) { return d === "easy" ? "Easy" : d === "medium" ? "Moderate" : "Hard"; }

export function mount(container, ctx) {
  let stage = null;           // active engine mount { destroy }
  let view = "home";          // home | hub | stage | result
  let hubId = null;
  let hubState = { q: "", sort: "new", filter: "all", diff: "all" };
  let ctExam = "hcm", ctDur = 10;
  let customRun = null;       // { examId, text, durMin, backspaceOverride }

  function killStage() { if (stage) { try { stage.destroy(); } catch (e) {} stage = null; } }
  function goProgress() { location.hash = "#/progress"; }
  /* "Practise My Mistakes" (Stage 3): hand the finished entry to
     Progress, which starts its revision session there — the current
     site's flow. The engine stamps window.__lastEntryClientId with the
     just-saved entry before firing the callback. */
  function goProgressMistakes(entry) {
    const cid = (entry && entry.clientId) || (typeof window !== "undefined" ? window.__lastEntryClientId : null);
    if (cid) setPendingMistakeEntry(cid);
    location.hash = "#/progress";
  }

  /* ---------------- Arena home ---------------- */
  function renderHome() {
    killStage(); view = "home"; customRun = null;
    container.innerHTML =
      '<section class="arena-head">' +
        '<h1>Exam Arena</h1>' +
        '<p>Official exam mocks with each exam\'s real rules — duration, backspace, scoring — plus custom mocks on your own passage.</p>' +
      '</section>' +
      '<h2 class="arena-sec">Official Exam Mocks</h2>' +
      '<div class="hub-grid">' +
        EXAM_SPECS.map(function (sp) {
          const n = testsOf(sp.id).length;
          const done = attemptedCount(sp.id);
          return '<button class="hub-card" type="button" data-hub="' + sp.id + '">' +
            '<h3>' + escapeHtml(sp.name) + '</h3>' +
            '<div class="hc-posts">' + escapeHtml(sp.posts) + '</div>' +
            '<div class="hc-meta">' +
              '<span class="pillStat">' + n + ' tests</span>' +
              '<span class="pillStat">' + escapeHtml(sp.durationLabel) + '</span>' +
              '<span class="pillStat">' + escapeHtml(sp.targetLabel) + '</span>' +
              (done ? '<span class="badge pass">' + done + ' attempted</span>' : "") +
            '</div></button>';
        }).join("") +
      '</div>' +
      '<div class="card custom-card">' +
        '<h2>Custom Mocks</h2>' +
        '<p class="sub">Paste any passage — it is scored with the full rules of the pattern you pick.</p>' +
        '<div class="controls" id="ctPills">' +
          EXAM_SPECS.map(function (sp) {
            return '<button class="pill ctPill' + (ctExam === sp.id ? " active" : "") + '" type="button" data-exam="' + sp.id + '">' + escapeHtml(sp.short) + '</button>';
          }).join("") +
        '</div>' +
        '<div class="field"><textarea id="ctText" rows="5" placeholder="Paste your passage here (at least ~100 characters)…"></textarea></div>' +
        '<div class="controls"><span class="small">Duration</span><span id="ctDurs">' +
          [1, 2, 5, 10, 15].map(function (d) {
            return '<button class="pill cdur' + (ctDur === d ? " active" : "") + '" type="button" data-min="' + d + '">' + d + 'm</button>';
          }).join("") +
        '</span>' +
        '<span style="flex:1"></span>' +
        '<button class="btn" type="button" id="ctStart">Start Custom Mock</button></div>' +
        '<p class="form-msg" id="ctMsg"></p>' +
      '</div>';
    container.querySelectorAll("[data-hub]").forEach(function (b) {
      b.addEventListener("click", function () { openHub(b.getAttribute("data-hub")); });
    });
    container.querySelectorAll(".ctPill").forEach(function (b) {
      b.addEventListener("click", function () {
        ctExam = b.getAttribute("data-exam");
        ctDur = specOf(ctExam).durationMin;
        renderHome();
        const ta = container.querySelector("#ctText"); if (ta) ta.focus();
      });
    });
    container.querySelectorAll(".cdur").forEach(function (b) {
      b.addEventListener("click", function () {
        ctDur = +b.getAttribute("data-min");
        container.querySelectorAll(".cdur").forEach(function (x) { x.classList.toggle("active", x === b); });
      });
    });
    container.querySelector("#ctStart").addEventListener("click", startCustom);
  }

  function startCustom() {
    const ta = container.querySelector("#ctText"), msg = container.querySelector("#ctMsg");
    const text = (ta ? ta.value : "").replace(/\s+/g, " ").trim();
    if (text.length < 100) {
      if (msg) { msg.textContent = "Paste a fuller passage first — at least about 100 characters — so the pattern can score it properly."; msg.style.color = "var(--error)"; }
      return;
    }
    customRun = { examId: ctExam, text: text, durMin: ctDur, backspaceOverride: undefined };
    launchCustom();
  }

  function launchCustom() {
    const run = customRun; if (!run) return;
    const sp = specOf(run.examId);
    killStage(); view = "stage";
    container.innerHTML = '<div id="stageSlot"></div>';
    const slot = container.querySelector("#stageSlot");
    if (run.examId === "hcm") {
      stage = mountHcmStage(slot, {
        ctx: "exam", mode: "custom", durMin: run.durMin, paperView: true,
        title: "Custom Test — Delhi Police HCM", examLabel: sp.short,
        silo: { key: "customtest", items: [{ id: "customMock", name: "Custom Test — Delhi Police HCM", text: run.text, isDrill: false }], index: 0 },
        onExit: renderHome,
        onFinish: function () {},
        onPractiseMistakes: goProgressMistakes,
        onExamSwitch: switchExamFromStage
      });
    } else {
      stage = mountExamStage(slot, {
        spec: sp,
        test: { id: "custom-" + run.examId, num: 0, name: "Custom Test", text: run.text, diff: "medium", topic: "Custom text" },
        custom: true, durMin: run.durMin, backspaceOverride: run.backspaceOverride,
        onBack: renderHome,
        onFinish: function () {},
        onPractiseMistakes: goProgressMistakes,
        onProgress: goProgress,
        onExamSwitch: switchExamFromStage,
        onBackspaceToggle: function (next) { run.backspaceOverride = next; launchCustom(); }
      });
    }
    if (stage && stage.focus) stage.focus();
  }

  function switchExamFromStage(examId) {
    if (customRun) {
      customRun.examId = examId;
      customRun.backspaceOverride = undefined;
      customRun.durMin = customRun.examId === "hcm" || customRun.durMin ? customRun.durMin : specOf(examId).durationMin;
      launchCustom();
    } else {
      openHub(examId);
    }
  }

  /* ---------------- Hub lists ---------------- */
  function openHub(examId) {
    killStage(); customRun = null;
    hubId = examId; hubState = { q: "", sort: "new", filter: "all", diff: "all" };
    setActiveExam(examId);
    renderHub();
  }
  function renderHub() {
    view = "hub";
    const sp = specOf(hubId); if (!sp) { renderHome(); return; }
    const tests = testsOf(sp.id);
    container.innerHTML =
      '<button class="pill" type="button" id="hubBack">← Exam Arena</button>' +
      '<h1 style="font-size:28px;margin-top:12px">' + escapeHtml(sp.name) + '</h1>' +
      '<p class="sub">' + escapeHtml(sp.posts) + '</p>' +
      '<div class="patStrip">' +
        '<span class="psItem"><span class="psL">Duration</span><span class="psV">' + escapeHtml(sp.durationLabel) + '</span></span>' +
        '<span class="psItem"><span class="psL">Target</span><span class="psV">' + escapeHtml(sp.targetLabel) + '</span></span>' +
        '<span class="psItem"><span class="psL">Error rule</span><span class="psV">' + escapeHtml(sp.errorAllowance) + '</span></span>' +
        '<span class="psItem"><span class="psL">Penalty</span><span class="psV">' + escapeHtml(sp.penaltyLabel) + '</span></span>' +
        '<span class="psItem"><span class="psL">Backspace</span><span class="psV">' + (sp.backspace ? "Allowed" : "Disabled") + '</span></span>' +
        '<span class="psItem"><span class="psL">Evaluation</span><span class="psV">' + escapeHtml(sp.evaluation) + '</span></span>' +
      '</div>' +
      '<div class="card"><h2>Tests</h2>' +
        '<div class="controls"><input class="searchBox text-input" id="tlSearch" type="search" placeholder="Search by name or number…" style="flex:1 1 200px" value="' + escapeHtml(hubState.q) + '">' +
        '<select id="tlSort" class="text-input" style="width:auto" aria-label="Sort tests"><option value="new"' + (hubState.sort === "new" ? " selected" : "") + '>Newest first</option><option value="old"' + (hubState.sort === "old" ? " selected" : "") + '>Oldest first</option></select></div>' +
        '<div class="controls" id="tlFilters">' +
          '<button class="pill tlF" data-f="all" type="button">All</button><button class="pill tlF" data-f="done" type="button">Attempted</button><button class="pill tlF" data-f="todo" type="button">Not attempted</button><span style="flex:1"></span>' +
          '<button class="pill tlD" data-d="all" type="button">All difficulties</button><button class="pill tlD" data-d="easy" type="button">Easy</button><button class="pill tlD" data-d="medium" type="button">Moderate</button><button class="pill tlD" data-d="hard" type="button">Hard</button>' +
        '</div>' +
        '<div id="tlList"></div>' +
        '<p class="small" style="margin:10px 0 0;opacity:.75">' + escapeHtml(sp.pibNote) + '</p>' +
      '</div>' +
      '<details class="card guide-details"><summary>How ' + escapeHtml(sp.short) + ' typing is scored</summary>' +
        '<ul class="tight">' + sp.formula.map(function (f) { return '<li>' + escapeHtml(f) + '</li>'; }).join("") + '</ul>' +
        sp.faq.map(function (f) { return '<p><strong>' + escapeHtml(f[0]) + '</strong><br>' + escapeHtml(f[1]) + '</p>'; }).join("") +
      '</details>';
    container.querySelector("#hubBack").addEventListener("click", renderHome);
    const srch = container.querySelector("#tlSearch");
    srch.addEventListener("input", function () { hubState.q = srch.value; renderTestList(); });
    const srt = container.querySelector("#tlSort");
    srt.addEventListener("change", function () { hubState.sort = srt.value; renderTestList(); });
    container.querySelectorAll(".tlF").forEach(function (b) { b.addEventListener("click", function () { hubState.filter = b.getAttribute("data-f"); renderTestList(); }); });
    container.querySelectorAll(".tlD").forEach(function (b) { b.addEventListener("click", function () { hubState.diff = b.getAttribute("data-d"); renderTestList(); }); });
    renderTestList();
  }
  function renderTestList() {
    const sp = specOf(hubId); const wrap = container.querySelector("#tlList"); if (!wrap) return;
    container.querySelectorAll(".tlF").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-f") === hubState.filter); });
    container.querySelectorAll(".tlD").forEach(function (b) {
      const d = b.getAttribute("data-d");
      const cnt = d === "all" ? testsOf(sp.id).length : testsOf(sp.id).filter(function (t) { return t.diff === d; }).length;
      b.classList.toggle("active", d === hubState.diff);
      if (d !== "all") b.textContent = diffLabel(d) + " (" + cnt + ")";
    });
    let tests = testsOf(sp.id).slice();
    if (hubState.sort === "new") tests.sort(function (a, b) { return b.num - a.num; }); else tests.sort(function (a, b) { return a.num - b.num; });
    const q = hubState.q.toLowerCase();
    let rowsHtml = "";
    tests.forEach(function (t) {
      const att = sp.id === "hcm" ? (lessonStatus(t.id).completed ? {} : null) : attemptedEntry(t.id);
      if (hubState.filter === "done" && !att) return;
      if (hubState.filter === "todo" && att) return;
      if (hubState.diff !== "all" && t.diff !== hubState.diff) return;
      if (q && (t.name.toLowerCase().indexOf(q) < 0 && String(t.num).indexOf(q) < 0 && (t.topic || "").toLowerCase().indexOf(q) < 0)) return;
      const wc = wordCountOf(t.text);
      const act = att
        ? "<button class='btn secondary trResult' data-tid='" + t.id + "' type='button'>Result</button><button class='btn trStart' data-tid='" + t.id + "' type='button'>Retake</button>"
        : "<button class='btn trStart' data-tid='" + t.id + "' type='button'>Start Test →</button>";
      rowsHtml += "<div class='testRow'><span class='trNum'>" + t.num + "</span><span class='trMain'><strong>" + escapeHtml(t.name) + "</strong>" + ((sp.id === "hcm" && t.isNew) ? "<span class='badge new'>New</span>" : "") + (t.topic ? "<span class='trTopic'>" + escapeHtml(t.topic) + "</span>" : "") + "<span>" + wc + " words · " + fmtNum(t.text.length) + " keystrokes" + (att ? " · ✓ Attempted" : "") + "</span></span><span class='badge " + (t.diff === "easy" ? "pass" : t.diff === "medium" ? "target" : "error") + "'>" + diffLabel(t.diff) + "</span><span class='trAct'>" + act + "</span></div>";
    });
    wrap.innerHTML = rowsHtml || "<p class='small'>No tests match these filters.</p>";
    wrap.querySelectorAll(".trStart").forEach(function (b) { b.addEventListener("click", function () { startHubTest(sp.id, b.getAttribute("data-tid")); }); });
    wrap.querySelectorAll(".trResult").forEach(function (b) {
      b.addEventListener("click", function () {
        const en = sp.id === "hcm" ? hcmEntryForTest(b.getAttribute("data-tid")) : attemptedEntry(b.getAttribute("data-tid"));
        if (en) openStoredResult(en); else goProgress();
      });
    });
  }

  /* ---------------- launching tests ---------------- */
  function hubMockSilo(currentId) {
    const items = testsOf("hcm").map(function (t) {
      return { id: t.id, name: t.name, text: t.text, isDrill: true, diff: t.diff, topic: t.topic };
    });
    let idx = 0; items.forEach(function (it, i) { if (it.id === currentId) idx = i; });
    return { key: "hubmock", items: items, index: idx };
  }
  function startHubTest(examId, testId) {
    killStage(); view = "stage"; customRun = null;
    container.innerHTML = '<div id="stageSlot"></div>';
    const slot = container.querySelector("#stageSlot");
    if (examId === "hcm") {
      const sp = specOf("hcm");
      stage = mountHcmStage(slot, {
        ctx: "exam", mode: "official", durMin: sp.durationMin,
        title: sp.name, examLabel: sp.short,
        silo: hubMockSilo(testId), initialIsDrill: false,
        onExit: function () { openHub("hcm"); },
        onFinish: function () {},
        onPractiseMistakes: goProgressMistakes,
        onExamSwitch: switchExamFromStage
      });
    } else {
      const sp = specOf(examId);
      const t = testsOf(examId).find(function (x) { return x.id === testId; }); if (!t) { openHub(examId); return; }
      stage = mountExamStage(slot, {
        spec: sp, test: t, custom: false, silo: testsOf(examId),
        onBack: function () { openHub(examId); },
        onFinish: function () {},
        onPractiseMistakes: goProgressMistakes,
        onProgress: goProgress,
        onExamSwitch: switchExamFromStage
      });
    }
    if (stage && stage.focus) stage.focus();
  }

  function openStoredResult(en) {
    killStage(); view = "result";
    container.innerHTML = '<div id="stageSlot"></div>';
    const slot = container.querySelector("#stageSlot");
    const handlers = {
      onBack: function () { if (en.examId) openHub(en.examId); else renderHome(); },
      onRetake: function (t) { if (en.examId && t && t.id) startHubTest(en.examId, t.id); else if (en.examId) openHub(en.examId); else renderHome(); },
      onPractise: function () { goProgressMistakes(en); },
      onProgress: goProgress
    };
    if (en.examId && specOf(en.examId)) renderStoredExamResultInto(slot, en, handlers);
    else renderStoredHcmResultInto(slot, en, handlers);
    window.scrollTo(0, 0);
  }

  /* ---------------- boot ---------------- */
  if (ctx && ctx.param && specOf(ctx.param)) openHub(ctx.param);
  else renderHome();

  return { destroy: function () { killStage(); } };
}
