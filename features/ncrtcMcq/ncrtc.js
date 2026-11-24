/* features/ncrtcMcq — ISOLATED NCRTC MCQ section (prompt §6).
   Everything NCRTC lives in this folder + styles/ncrtc.css + data/ncrtc/:
   deleting this folder, its stylesheet and the single "ncrtc" route in
   app.js removes the section cleanly. Nothing outside this folder imports
   from it; it imports only core/storage.js (the ncrtcBestV1 helpers) and
   data/ncrtcManifest.js.

   Behaviour is a faithful port of the current site's NCRTC engine
   (typesetu-ncrtc @ 284090d, assets/js/ncrtc.js): same manifest order,
   same landing, same runner flow, same confirm-on-submit modal, same
   scoring (count correct, NO negative marking), same review cards with
   explanations, same best-score storage — ncrtcBestV1, written only when
   the score improves (or ties with >= total) via core/storage.js.

   v26 runner layout (presentation restyle at sid's request — the
   runner now LOOKS like the Vocab runner, whose design he prefers):
   the action row (Previous · Next · Mark for Review · Clear Response)
   sits DIRECTLY BELOW the question + options box inside the question
   card — no fixed bottom bar; Submit / Quit live in the palette card;
   the palette carries the SSC states (answered = green, visited-not-
   answered = red, marked = purple, answered + marked = purple with a
   green dot, not visited = neutral) with the same legend. Left/right
   arrow keys navigate too. PRESENTATION ONLY: test data, durations,
   scoring (count correct, NO negative marking), the result screen and
   ncrtcBestV1 semantics are exactly as before.

   ADDITIONS vs the current engine (prompt-directed, flagged in the
   Stage 4 report — NOT preservations):
   - Mark for Review: the current engine has no such control (Stage 0
     finding). Here it is a VISUAL-ONLY flag: it recolours the palette
     cell and nothing else — it never touches answers, scoring, the
     golden outputs, or ncrtcBestV1. (A `visited` set likewise exists
     only to paint the palette's "seen, not answered" state.)
   - Clear Response: sets the current answer back to unattempted —
     exactly equivalent to never having answered (a skip); scoring and
     stored state are unaffected.
   The current engine has NO test timer; none is invented here. */

import { NCRTC_MANIFEST } from "../../data/ncrtcManifest.js";
import { loadNcrtcBests, saveNcrtcBest } from "../../core/storage.js";

const DATA_BASE = "data/ncrtc/";
const CAT_TITLES = {
  technical: "Technical — Subject Knowledge (60 marks)",
  gs: "General Studies — most-probable MCQs",
  ca: "Current Affairs — month-wise"
};
const CAT_ORDER = ["technical", "gs", "ca"];

/* Same escaping as the source engine. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function bestBadge(id, bests) {
  const b = bests[id];
  if (!b) return '<span class="badge target">Not attempted</span>';
  const pct = Math.round(100 * b.score / b.total);
  return '<span class="badge pass">Best: ' + b.score + "/" + b.total + " (" + pct + "%)</span>";
}
/* The manifest's pdf values carry the old site's path prefix
   ("assets/data/ncrtc/…"); the byte-identical PDFs live under data/ncrtc/
   in this tree, so the link is resolved by file name. */
function pdfHref(pdf) { return DATA_BASE + String(pdf).split("/").pop(); }

export function mount(container) {
  let destroyed = false;
  let cur = null;        /* {test, data, answers:[], marked:Set, visited:Set, idx, submitted, score} */
  let loadToken = 0;
  let modalState = null; /* {ov, resolve} while the confirm modal is open */

  container.innerHTML =
    '<section class="ncrtc-head"><h1>NCRTC Mocks</h1>' +
    '<p>Supervisor-I (Operations) D01 — ' + NCRTC_MANIFEST.tests.length + ' tests · ' +
    NCRTC_MANIFEST.tests.reduce(function (a, t) { return a + (t.count || 0); }, 0) + ' questions · ' +
    '<span id="ncAttemptedLine"></span></p>' +
    '<p>Topic-wise MCQ tests built from your NCRTC book — every question has an explanation after you submit.</p></section>' +
    '<div id="ncBody"></div>' +
    '<div id="ncRunner" style="display:none">' +
      '<div class="ncWrap">' +
        '<div class="card ncQCard">' +
          '<div class="ncMeta"><strong id="ncTestTitle"></strong></div>' +
          '<p class="ncProgress" id="ncProgress"></p>' +
          '<div class="ncQText" id="ncQText"></div>' +
          '<div class="ncOpts" id="ncOpts"></div>' +
          '<div class="ncActions">' +
            '<button class="btn ncActBtn" type="button" id="ncPrevBtn">← Previous</button>' +
            '<button class="btn ncActBtn" type="button" id="ncNextBtn">Next →</button>' +
            '<button class="pill ncActPill" type="button" id="ncMarkBtn" aria-pressed="false">Mark for Review</button>' +
            '<button class="pill ncActPill" type="button" id="ncClearBtn">Clear Response</button>' +
          '</div>' +
        '</div>' +
        '<div class="card ncPalCard">' +
          '<strong>Question palette</strong>' +
          '<div class="ncPalette" id="ncPalette"></div>' +
          '<div class="ncPalSummary" id="ncPalSummary"></div>' +
          '<div class="ncLegend">' +
            '<span><span class="ncDot done"></span>Answered</span>' +
            '<span><span class="ncDot seen"></span>Seen, not answered</span>' +
            '<span><span class="ncDot marked"></span>Marked for review</span>' +
            '<span><span class="ncDot ansMarked"></span>Answered + marked</span>' +
            '<span><span class="ncDot"></span>Not visited</span>' +
          '</div>' +
          '<button class="btn ncSubmitBtn" type="button" id="ncSubmitBtn">Submit Test</button>' +
          '<button class="pill ncQuitBtn" type="button" id="ncQuitBtn">Quit</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="ncResult" style="display:none"></div>';

  const el = function (id) { return container.querySelector("#" + id); };
  const body = el("ncBody"), runner = el("ncRunner"), result = el("ncResult");

  /* ---------------- landing ---------------- */
  function renderLanding() {
    if (destroyed) return;
    runner.style.display = "none";
    result.style.display = "none";
    body.style.display = "";
    const bests = loadNcrtcBests();
    const doneCount = Object.keys(bests).length;
    el("ncAttemptedLine").textContent = doneCount + " attempted so far.";
    let html = "";
    CAT_ORDER.forEach(function (cat) {
      const tests = NCRTC_MANIFEST.tests.filter(function (t) { return t.category === cat; });
      if (!tests.length) return;
      html += '<h2 class="ncCatHead">' + esc(CAT_TITLES[cat] || cat) + "</h2>";
      const groups = [], byGroup = {};
      tests.forEach(function (t) {
        if (!byGroup[t.group]) { byGroup[t.group] = []; groups.push(t.group); }
        byGroup[t.group].push(t);
      });
      groups.forEach(function (g) {
        html += '<h3 class="ncrtc-group">' + esc(g) + "</h3>";
        byGroup[g].forEach(function (t) {
          html += '<div class="ncrtc-row">' +
            '<span class="nr-main"><span class="nr-title">' + esc(t.title) + '</span>' +
            '<span class="nr-sub">' + t.count + ' questions' + (t.pdf ? ' · Reading PDF included' : '') + '</span></span>' +
            bestBadge(t.id, bests) +
            (t.pdf ? '<a class="pill ncPdfBtn" href="' + esc(pdfHref(t.pdf)) + '" target="_blank" rel="noopener">Read PDF</a>' : "") +
            '<button class="btn sm" type="button" data-nc-start="' + esc(t.id) + '">Start test</button>' +
            "</div>";
        });
      });
    });
    body.innerHTML = html;
    body.querySelectorAll("[data-nc-start]").forEach(function (b) {
      b.addEventListener("click", function () { startTest(b.getAttribute("data-nc-start")); });
    });
  }

  /* ---------------- runner ---------------- */
  function startTest(id) {
    let meta = null;
    NCRTC_MANIFEST.tests.forEach(function (t) { if (t.id === id) meta = t; });
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
        marked: new Set(), visited: new Set([0]), idx: 0, submitted: false, score: 0
      };
      body.style.display = "none";
      result.style.display = "none";
      runner.style.display = "";
      renderQuestion();
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
    el("ncTestTitle").textContent = cur.test.title;
    el("ncProgress").textContent = "Question " + (i + 1) + " of " + qs.length +
      " · Attempted " + cur.answers.filter(function (a) { return a !== null; }).length;
    el("ncQText").textContent = (i + 1) + ". " + q.q;
    const opts = el("ncOpts");
    opts.innerHTML = "";
    q.options.forEach(function (op, oi) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ncOpt" + (cur.answers[i] === oi ? " sel" : "");
      b.innerHTML = '<span class="ncOptKey">' + ("ABCD"[oi]) + "</span><span>" + esc(op) + "</span>";
      b.addEventListener("click", function () { cur.answers[i] = oi; renderQuestion(); });
      opts.appendChild(b);
    });
    el("ncPrevBtn").disabled = (i === 0);
    el("ncNextBtn").disabled = (i === qs.length - 1);
    const markBtn = el("ncMarkBtn");
    const isMarked = cur.marked.has(i);
    markBtn.classList.toggle("active", isMarked);
    markBtn.setAttribute("aria-pressed", isMarked ? "true" : "false");
    el("ncClearBtn").disabled = (cur.answers[i] === null);
    const pal = el("ncPalette");
    pal.innerHTML = "";
    qs.forEach(function (_, pi) {
      const p = document.createElement("button");
      p.type = "button";
      p.className = "ncPalBtn" + palState(pi) + (pi === i ? " now" : "");
      p.textContent = pi + 1;
      p.setAttribute("aria-label", "Go to question " + (pi + 1));
      p.addEventListener("click", function () { cur.idx = pi; renderQuestion(); });
      pal.appendChild(p);
    });
    const un = cur.answers.filter(function (a) { return a === null; }).length;
    const mk = cur.marked.size;
    el("ncPalSummary").textContent = "Attempted " + (qs.length - un) + " · Left " + un +
      (mk ? " · Marked " + mk : "");
  }

  function goPrev() { if (cur && cur.idx > 0) { cur.idx--; renderQuestion(); } }
  function goNext() { if (cur && cur.idx < cur.data.questions.length - 1) { cur.idx++; renderQuestion(); } }

  /* ---------------- confirm modal (ported behaviour) ---------------- */
  function ncConfirm(msg) {
    return new Promise(function (resolve) {
      const ov = document.createElement("div");
      ov.className = "ncModalOv";
      ov.innerHTML = '<div class="card ncModal"><p>' + esc(msg).replace(/\n/g, "<br>") + "</p>" +
        '<div class="ncModalBtns"><button class="btn" type="button" data-nc="ok">Yes, continue</button>' +
        '<button class="pill" type="button" data-nc="cancel">Cancel</button></div></div>';
      document.body.appendChild(ov);
      modalState = { ov: ov, resolve: resolve };
      /* Only the explicit buttons act: a click on the overlay/backdrop or
         the card itself is ignored, never a cancel — otherwise the second
         click of a hurried double-click on Submit/Quit lands on the overlay
         and silently dismisses this confirm (same safety as the Vocab
         runner's v25 fix). */
      ov.addEventListener("click", function (e) {
        const b = e.target.closest ? e.target.closest("[data-nc]") : null;
        if (!b) return;
        closeModal(b.getAttribute("data-nc") === "ok");
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

  /* ---------------- submit + result (ported behaviour) ---------------- */
  function submitTest() {
    if (!cur) return;
    const un = cur.answers.filter(function (a) { return a === null; }).length;
    const msg = "Submit this test?" + (un ? "\n\n" + un + " question(s) are still unattempted — they will score 0 (no negative marking)." : "");
    ncConfirm(msg).then(function (ok) { if (ok && !destroyed) doSubmit(); });
  }
  function doSubmit() {
    const qs = cur.data.questions;
    let score = 0;
    const skipped = cur.answers.filter(function (a) { return a === null; }).length;
    qs.forEach(function (q, i) { if (cur.answers[i] === q.answer) score++; });
    cur.score = score;
    cur.submitted = true;
    saveNcrtcBest(cur.test.id, score, qs.length);
    runner.style.display = "none";
    result.style.display = "";
    const pct = Math.round(100 * score / qs.length);
    let html = '<div class="card ncScoreCard"><h2>' + esc(cur.test.title) + "</h2>" +
      '<div class="ncScoreBig">' + score + " / " + qs.length + "</div>" +
      '<div class="ncScorePct">' + pct + "% · Correct " + score + " · Wrong " +
      (qs.filter(function (q, i) { return cur.answers[i] !== null && cur.answers[i] !== q.answer; }).length) +
      " · Skipped " + skipped + "</div>" +
      '<div class="ncResultBtns"><button class="btn" type="button" id="ncRetakeBtn">Retake test</button>' +
      '<button class="pill" type="button" id="ncBackBtn">All tests</button></div></div>';
    html += '<h2 class="ncCatHead">Review — every question with explanation</h2>';
    qs.forEach(function (q, i) {
      const ua = cur.answers[i], ok = (ua === q.answer);
      html += '<div class="card ncReview ' + (ok ? "ok" : (ua === null ? "skip" : "bad")) + '">' +
        '<div class="ncReviewHead"><strong>Q' + (i + 1) + ". " + esc(q.q) + '</strong>' +
        '<span class="ncTag ' + (ok ? "ok" : (ua === null ? "skip" : "bad")) + '">' +
        (ok ? "Correct" : (ua === null ? "Skipped" : "Wrong")) + "</span></div>" +
        '<div class="ncReviewOpts">';
      q.options.forEach(function (op, oi) {
        let cls = "ncROpt";
        if (oi === q.answer) cls += " correct";
        if (oi === ua && ua !== q.answer) cls += " yourWrong";
        html += '<div class="' + cls + '"><span class="ncOptKey">' + ("ABCD"[oi]) + "</span><span>" + esc(op) + "</span>" +
          (oi === q.answer ? ' <span class="ncMark">✓ correct</span>' : "") +
          (oi === ua && ua !== q.answer ? ' <span class="ncMark">← your answer</span>' : "") +
          (oi === ua && ua === q.answer ? ' <span class="ncMark">← your answer</span>' : "") + "</div>";
      });
      html += '</div><p class="ncExplain"><strong>Why:</strong> ' + esc(q.explain) + "</p></div>";
    });
    result.innerHTML = html;
    el("ncRetakeBtn").addEventListener("click", function () { startTest(cur.test.id); });
    el("ncBackBtn").addEventListener("click", function () {
      result.style.display = "none";
      renderLanding();
      window.scrollTo(0, 0);
    });
    window.scrollTo(0, 0);
  }

  function leaveTest() {
    const leave = function () {
      cur = null;
      loadToken++;
      runner.style.display = "none";
      result.style.display = "none";
      renderLanding();
      window.scrollTo(0, 0);
    };
    if (cur && !cur.submitted) {
      ncConfirm("Leave this test? Your answers in this attempt will be lost.").then(function (ok) {
        if (ok && !destroyed) leave();
      });
    } else leave();
  }

  /* ---------------- static runner controls ---------------- */
  el("ncPrevBtn").addEventListener("click", goPrev);
  el("ncNextBtn").addEventListener("click", goNext);
  el("ncSubmitBtn").addEventListener("click", submitTest);
  el("ncQuitBtn").addEventListener("click", leaveTest);
  el("ncMarkBtn").addEventListener("click", function () {
    if (!cur) return;
    if (cur.marked.has(cur.idx)) cur.marked.delete(cur.idx);
    else cur.marked.add(cur.idx);
    renderQuestion();
  });
  el("ncClearBtn").addEventListener("click", function () {
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
      document.removeEventListener("keydown", onKeydown);
      if (modalState) closeModal(false);
      cur = null;
    }
  };
}
