/* features/vocabMcq — ISOLATED Vocab MCQ section (TypeSetu v25).
   Everything Vocab lives in this folder + styles/vocab.css +
   data/vocabManifest.js + data/vocab/: deleting this folder, its
   stylesheet, its data and the single "vocab" route in app.js removes
   the section cleanly. It imports nothing from features/ncrtcMcq and
   touches no typing state: its only storage is the NEW local key
   vocabBestV1 (best score per test, written only when it improves —
   the same approach as NCRTC's ncrtcBestV1).

   Content: chapterwise SSC CPO vocab mocks generated from the AppxV2
   lecture PDF — 50 chapters, 82 tests (long chapters split into
   near-equal parts), 4,264 questions. Runner mirrors the NCRTC
   section's architecture with the Vocab-specific behaviour the brief
   requires:
   - the action row (Previous · Next · Mark for Review · Clear
     Response) sits DIRECTLY BELOW the question + options box — no
     fixed bottom bar;
   - SSC-style palette states: answered = green, visited-not-answered
     = red, marked = purple, answered + marked = purple with a green
     dot, not visited = neutral;
   - a countdown timer from the test's durationMins (SSC CPO pace,
     0.6 min/question) with auto-submit on expiry;
   - SSC CPO 2025 marking: +1 correct, −0.25 wrong, 0 skipped. */

import { VOCAB_MANIFEST } from "../../data/vocabManifest.js";

const DATA_BASE = "data/vocab/";
const BEST_KEY = "vocabBestV1";

/* ---- best-score storage (mirrors core/storage.js NCRTC approach) ---- */
function loadVocabBests() {
  try {
    const b = JSON.parse(localStorage.getItem(BEST_KEY));
    return b && typeof b === "object" && !Array.isArray(b) ? b : {};
  } catch (e) { return {}; }
}
function saveVocabBest(id, score, total) {
  const all = loadVocabBests();
  const prev = all[id];
  if (!prev || score > prev.score || (score === prev.score && total >= prev.total)) {
    all[id] = { score: score, total: total, ts: Date.now() };
    try { localStorage.setItem(BEST_KEY, JSON.stringify(all)); } catch (e) {}
  }
  return all[id];
}

/* Same escaping as the NCRTC engine. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
/* Scores carry quarter marks (4.5, 3.75) — print them without noise. */
function fmtScore(x) {
  const r = Math.round(x * 100) / 100;
  return String(r);
}
function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}
function chapterOf(t) {
  const m = /^chapter-(\d+)/.exec(t.id);
  return m ? parseInt(m[1], 10) : 0;
}
function chapterTitle(t) { return t.title.replace(/\s*\(Part \d+\)\s*$/, ""); }
function partLabel(t) {
  const m = /\(Part (\d+)\)\s*$/.exec(t.title);
  return m ? "Part " + m[1] : "Complete test";
}
function bestBadge(id, bests) {
  const b = bests[id];
  if (!b) return '<span class="badge target">Not attempted</span>';
  return '<span class="badge pass">Best: ' + fmtScore(b.score) + "/" + b.total + "</span>";
}

export function mount(container) {
  let destroyed = false;
  let cur = null;        /* {test, data, answers:[], marked:Set, visited:Set, idx, submitted, endAt, timerId, auto} */
  let loadToken = 0;
  let modalState = null; /* {ov, resolve} while the confirm modal is open */

  container.innerHTML =
    '<section class="vcrtc-head"><h1>Vocab Mocks — SSC CPO Chapterwise</h1>' +
    '<p>' + VOCAB_MANIFEST.tests.length + ' tests · ' +
    VOCAB_MANIFEST.tests.reduce(function (a, t) { return a + (t.count || 0); }, 0) +
    ' questions · <span id="vcAttemptedLine"></span></p>' +
    '<p>Chapterwise vocabulary mocks in the SSC CPO pattern — marking: <strong>+1</strong> for a correct answer, ' +
    '<strong>−0.25</strong> for a wrong one, 0 for a skip. Every question has an explanation after you submit.</p></section>' +
    '<div id="vcBody"></div>' +
    '<div id="vcRunner" style="display:none">' +
      '<div class="vcWrap">' +
        '<div class="card vcQCard">' +
          '<div class="vcMeta"><strong id="vcTestTitle"></strong>' +
          '<span class="vcTimer" id="vcTimer" role="timer" aria-label="Time left"></span></div>' +
          '<p class="vcProgress" id="vcProgress"></p>' +
          '<div class="vcQText" id="vcQText"></div>' +
          '<div class="vcOpts" id="vcOpts"></div>' +
          '<div class="vcActions">' +
            '<button class="btn vcActBtn" type="button" id="vcPrevBtn">← Previous</button>' +
            '<button class="btn vcActBtn" type="button" id="vcNextBtn">Next →</button>' +
            '<button class="pill vcActPill" type="button" id="vcMarkBtn" aria-pressed="false">Mark for Review</button>' +
            '<button class="pill vcActPill" type="button" id="vcClearBtn">Clear Response</button>' +
          '</div>' +
        '</div>' +
        '<div class="card vcPalCard">' +
          '<strong>Question palette</strong>' +
          '<div class="vcPalette" id="vcPalette"></div>' +
          '<div class="vcPalSummary" id="vcPalSummary"></div>' +
          '<div class="vcLegend">' +
            '<span><span class="vcDot done"></span>Answered</span>' +
            '<span><span class="vcDot seen"></span>Seen, not answered</span>' +
            '<span><span class="vcDot marked"></span>Marked for review</span>' +
            '<span><span class="vcDot ansMarked"></span>Answered + marked</span>' +
            '<span><span class="vcDot"></span>Not visited</span>' +
          '</div>' +
          '<button class="btn vcSubmitBtn" type="button" id="vcSubmitBtn">Submit Test</button>' +
          '<button class="pill vcQuitBtn" type="button" id="vcQuitBtn">Quit</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="vcResult" style="display:none"></div>';

  const el = function (id) { return container.querySelector("#" + id); };
  const body = el("vcBody"), runner = el("vcRunner"), result = el("vcResult");

  /* ---------------- landing ---------------- */
  function renderLanding() {
    if (destroyed) return;
    stopTimer();
    runner.style.display = "none";
    result.style.display = "none";
    body.style.display = "";
    const bests = loadVocabBests();
    const doneCount = Object.keys(bests).length;
    el("vcAttemptedLine").textContent = doneCount + " attempted so far.";
    /* group the manifest (already in chapter order) by chapter */
    const chapters = [], byCh = {};
    VOCAB_MANIFEST.tests.forEach(function (t) {
      const n = chapterOf(t);
      if (!byCh[n]) { byCh[n] = []; chapters.push(n); }
      byCh[n].push(t);
    });
    let html = "";
    chapters.forEach(function (n) {
      const tests = byCh[n];
      html += '<h2 class="vcCatHead">' + esc(chapterTitle(tests[0])) +
        ' <span class="vcChGroup">' + esc(tests[0].group) + "</span></h2>";
      tests.forEach(function (t) {
        html += '<div class="vcrtc-row">' +
          '<span class="nr-main"><span class="nr-title">' + esc(tests.length > 1 ? partLabel(t) : t.title) + '</span>' +
          '<span class="nr-sub">' + t.count + ' questions · ' + t.durationMins + ' min</span></span>' +
          bestBadge(t.id, bests) +
          '<button class="btn sm" type="button" data-vc-start="' + esc(t.id) + '">Start test</button>' +
          "</div>";
      });
    });
    body.innerHTML = html;
    body.querySelectorAll("[data-vc-start]").forEach(function (b) {
      b.addEventListener("click", function () { startTest(b.getAttribute("data-vc-start")); });
    });
  }

  /* ---------------- timer ---------------- */
  function stopTimer() {
    if (cur && cur.timerId) { clearInterval(cur.timerId); cur.timerId = null; }
  }
  function paintTimer() {
    if (!cur) return;
    const left = (cur.endAt - Date.now()) / 1000;
    const t = el("vcTimer");
    if (t) {
      t.textContent = "⏱ " + fmtClock(left);
      t.classList.toggle("low", left <= 60 && left > 0);
    }
    return left;
  }
  function startTimer() {
    stopTimer();
    paintTimer();
    cur.timerId = setInterval(function () {
      if (destroyed || !cur || cur.submitted) { stopTimer(); return; }
      if (paintTimer() <= 0) { stopTimer(); doSubmit(true); }
    }, 250);
  }

  /* ---------------- runner ---------------- */
  function startTest(id) {
    let meta = null;
    VOCAB_MANIFEST.tests.forEach(function (t) { if (t.id === id) meta = t; });
    if (!meta) return;
    const token = ++loadToken;
    body.style.display = "";
    runner.style.display = "none";
    result.style.display = "none";
    body.innerHTML = '<p class="muted">Loading questions…</p>';
    fetch(DATA_BASE + id + ".json").then(function (r) { return r.json(); }).then(function (data) {
      if (destroyed || token !== loadToken) return;
      cur = {
        test: meta, data: data,
        answers: new Array(data.questions.length).fill(null),
        marked: new Set(), visited: new Set([0]), idx: 0,
        submitted: false, auto: false,
        endAt: Date.now() + (meta.durationMins || data.durationMins || 30) * 60000,
        timerId: null
      };
      body.style.display = "none";
      result.style.display = "none";
      runner.style.display = "";
      renderQuestion();
      startTimer();
    }).catch(function () {
      if (destroyed || token !== loadToken) return;
      body.innerHTML = '<div class="card"><p>Could not load this test. Check your connection and try again.</p></div>';
    });
  }

  function palState(pi) {
    const answered = cur.answers[pi] !== null, marked = cur.marked.has(pi);
    if (answered && marked) return " ansMarked";
    if (answered) return " done";
    if (marked) return " marked";
    if (cur.visited.has(pi)) return " seen";
    return "";
  }

  function renderQuestion() {
    if (!cur || destroyed) return;
    const qs = cur.data.questions, i = cur.idx, q = qs[i];
    cur.visited.add(i);
    el("vcTestTitle").textContent = cur.test.title;
    el("vcProgress").textContent = "Question " + (i + 1) + " of " + qs.length +
      " · Attempted " + cur.answers.filter(function (a) { return a !== null; }).length;
    el("vcQText").textContent = (i + 1) + ". " + q.q;
    const opts = el("vcOpts");
    opts.innerHTML = "";
    q.options.forEach(function (op, oi) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "vcOpt" + (cur.answers[i] === oi ? " sel" : "");
      b.innerHTML = '<span class="vcOptKey">' + ("ABCD"[oi]) + "</span><span>" + esc(op) + "</span>";
      b.addEventListener("click", function () { cur.answers[i] = oi; renderQuestion(); });
      opts.appendChild(b);
    });
    el("vcPrevBtn").disabled = (i === 0);
    el("vcNextBtn").disabled = (i === qs.length - 1);
    const markBtn = el("vcMarkBtn");
    const isMarked = cur.marked.has(i);
    markBtn.classList.toggle("active", isMarked);
    markBtn.setAttribute("aria-pressed", isMarked ? "true" : "false");
    el("vcClearBtn").disabled = (cur.answers[i] === null);
    const pal = el("vcPalette");
    pal.innerHTML = "";
    qs.forEach(function (_, pi) {
      const p = document.createElement("button");
      p.type = "button";
      p.className = "vcPalBtn" + palState(pi) + (pi === i ? " now" : "");
      p.textContent = pi + 1;
      p.setAttribute("aria-label", "Go to question " + (pi + 1));
      p.addEventListener("click", function () { cur.idx = pi; renderQuestion(); });
      pal.appendChild(p);
    });
    const un = cur.answers.filter(function (a) { return a === null; }).length;
    const mk = cur.marked.size;
    el("vcPalSummary").textContent = "Attempted " + (qs.length - un) + " · Left " + un +
      (mk ? " · Marked " + mk : "");
    paintTimer();
  }

  function goPrev() { if (cur && cur.idx > 0) { cur.idx--; renderQuestion(); } }
  function goNext() { if (cur && cur.idx < cur.data.questions.length - 1) { cur.idx++; renderQuestion(); } }

  /* ---------------- confirm modal (mirrors the NCRTC runner) ---------------- */
  function vcConfirm(msg) {
    return new Promise(function (resolve) {
      const ov = document.createElement("div");
      ov.className = "vcModalOv";
      ov.innerHTML = '<div class="card vcModal"><p>' + esc(msg).replace(/\n/g, "<br>") + "</p>" +
        '<div class="vcModalBtns"><button class="btn" type="button" data-vc="ok">Yes, continue</button>' +
        '<button class="pill" type="button" data-vc="cancel">Cancel</button></div></div>';
      document.body.appendChild(ov);
      modalState = { ov: ov, resolve: resolve };
      /* Only the explicit buttons act: a click on the overlay/backdrop or
         the card itself is ignored, never a cancel — otherwise the second
         click of a hurried double-click on Submit/Quit lands on the overlay
         and silently dismisses this confirm, leaving the test unsubmitted
         while the student believes it went through. */
      ov.addEventListener("click", function (e) {
        const b = e.target.closest ? e.target.closest("[data-vc]") : null;
        if (!b) return;
        closeModal(b.getAttribute("data-vc") === "ok");
      });
    });
  }
  function closeModal(ok) {
    if (!modalState) return;
    const m = modalState;
    modalState = null;
    m.ov.remove();
    m.resolve(ok);
  }

  /* ---------------- submit + result (SSC CPO 2025 marking) ---------------- */
  function submitTest() {
    if (!cur || cur.submitted) return;
    const un = cur.answers.filter(function (a) { return a === null; }).length;
    const msg = "Submit this test?" + (un ? "\n\n" + un + " question(s) are still unattempted — they score 0. Wrong answers cost 0.25 each." : "");
    vcConfirm(msg).then(function (ok) { if (ok && !destroyed) doSubmit(false); });
  }
  function doSubmit(auto) {
    if (!cur || cur.submitted) return;
    stopTimer();
    cur.auto = !!auto;
    const qs = cur.data.questions;
    let correct = 0, wrong = 0;
    qs.forEach(function (q, i) {
      if (cur.answers[i] === null) return;
      if (cur.answers[i] === q.answer) correct++; else wrong++;
    });
    const skipped = qs.length - correct - wrong;
    const score = correct - wrong * 0.25;
    const attempted = correct + wrong;
    const accuracy = attempted ? Math.round(100 * correct / attempted) : 0;
    const totalSecs = (cur.test.durationMins || cur.data.durationMins || 0) * 60;
    const usedSecs = Math.max(0, Math.min(totalSecs, totalSecs - Math.round((cur.endAt - Date.now()) / 1000)));
    cur.submitted = true;
    saveVocabBest(cur.test.id, score, qs.length);
    runner.style.display = "none";
    result.style.display = "";
    let html = '<div class="card vcScoreCard"><h2>' + esc(cur.test.title) + "</h2>" +
      '<div class="vcScoreBig">' + fmtScore(score) + " / " + qs.length + "</div>" +
      '<div class="vcScorePct">Correct ' + correct + " · Wrong " + wrong + " · Skipped " + skipped +
      " · Accuracy " + accuracy + "% · Time used " + fmtClock(usedSecs) + "</div>" +
      '<div class="vcScorePct">Marking: +1 correct · −0.25 wrong · 0 skipped (SSC CPO 2025)</div>' +
      (cur.auto ? '<div class="vcScorePct">Time expired — the test was auto-submitted.</div>' : "") +
      '<div class="vcResultBtns"><button class="btn" type="button" id="vcRetakeBtn">Retake test</button>' +
      '<button class="pill" type="button" id="vcBackBtn">All tests</button></div></div>';
    html += '<h2 class="vcCatHead">Review — every question with explanation</h2>';
    qs.forEach(function (q, i) {
      const ua = cur.answers[i], ok = (ua === q.answer);
      html += '<div class="card vcReview ' + (ok ? "ok" : (ua === null ? "skip" : "bad")) + '">' +
        '<div class="vcReviewHead"><strong>Q' + (i + 1) + ". " + esc(q.q) + '</strong>' +
        '<span class="vcTag ' + (ok ? "ok" : (ua === null ? "skip" : "bad")) + '">' +
        (ok ? "Correct +1" : (ua === null ? "Skipped 0" : "Wrong −0.25")) + "</span></div>" +
        '<div class="vcReviewOpts">';
      q.options.forEach(function (op, oi) {
        let cls = "vcROpt";
        if (oi === q.answer) cls += " correct";
        if (oi === ua && ua !== q.answer) cls += " yourWrong";
        html += '<div class="' + cls + '"><span class="vcOptKey">' + ("ABCD"[oi]) + "</span><span>" + esc(op) + "</span>" +
          (oi === q.answer ? ' <span class="vcMark">✓ correct</span>' : "") +
          (oi === ua && ua !== q.answer ? ' <span class="vcMark">← your answer</span>' : "") +
          (oi === ua && ua === q.answer ? ' <span class="vcMark">← your answer</span>' : "") + "</div>";
      });
      html += '</div><p class="vcExplain"><strong>Why:</strong> ' + esc(q.explain) + "</p></div>";
    });
    result.innerHTML = html;
    el("vcRetakeBtn").addEventListener("click", function () { startTest(cur.test.id); });
    el("vcBackBtn").addEventListener("click", function () {
      result.style.display = "none";
      renderLanding();
      window.scrollTo(0, 0);
    });
    window.scrollTo(0, 0);
  }

  function leaveTest() {
    const leave = function () {
      stopTimer();
      cur = null;
      loadToken++;
      runner.style.display = "none";
      result.style.display = "none";
      renderLanding();
      window.scrollTo(0, 0);
    };
    if (cur && !cur.submitted) {
      vcConfirm("Leave this test? Your answers in this attempt will be lost.").then(function (ok) {
        if (ok && !destroyed) leave();
      });
    } else leave();
  }

  /* ---------------- static runner controls ---------------- */
  el("vcPrevBtn").addEventListener("click", goPrev);
  el("vcNextBtn").addEventListener("click", goNext);
  el("vcSubmitBtn").addEventListener("click", submitTest);
  el("vcQuitBtn").addEventListener("click", leaveTest);
  el("vcMarkBtn").addEventListener("click", function () {
    if (!cur) return;
    if (cur.marked.has(cur.idx)) cur.marked.delete(cur.idx);
    else cur.marked.add(cur.idx);
    renderQuestion();
  });
  el("vcClearBtn").addEventListener("click", function () {
    if (!cur) return;
    cur.answers[cur.idx] = null;
    renderQuestion();
  });

  function onKeydown(e) {
    if (destroyed || modalState || !cur || cur.submitted) return;
    if (runner.style.display === "none") return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
  }
  document.addEventListener("keydown", onKeydown);

  renderLanding();

  return {
    destroy: function () {
      destroyed = true;
      loadToken++;
      stopTimer();
      document.removeEventListener("keydown", onKeydown);
      if (modalState) closeModal(false);
      cur = null;
    }
  };
}
