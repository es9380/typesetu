/* features/trainingStudio — Training Studio (Stage 3).
   Sub-tabs: 15-Min Warm-Up | Skill Drills | Theme Practice.
   Everything here runs the PRACTICE personality on the shared stage
   (core/examEngine.js mountPracticeStage): count-up timer, no marks,
   siloed passage picker, practice result card — the current app's
   behaviour, re-homed. Launch parameters mirror the old launchers
   exactly: drills keep the boot-default duration (5), warm-up subsets
   launch at 15 with the 15:00 cap, theme/paste at the default.
   Numbers lessons (num1–num6) carry the live finger-hint panel with
   its persisted toggle (SETTINGS.numHints) — verbatim port. */

import { WARMUPS, warmupSet } from "../../data/warmups.js";
import { DRILLS, SESSION_CATS, DIFF, diffLabel, textById } from "../../data/drills.js";
import {
  lessonStatus, loadBest, loadHist, entryTs, SETTINGS, persistSettings
} from "../../core/storage.js";
import { wordCountOf } from "../../core/scoringMatrix.js";
import { mountPracticeStage } from "../../core/examEngine.js";
import { icon } from "../../components/icons.js";
import { escapeHtml } from "../../components/ProfilePopover.js";

const TABS = [
  { id: "warmup", label: "15-Min Warm-Up" },
  { id: "drills", label: "Skill Drills" },
  { id: "theme", label: "Theme Practice" }
];
const PART_ACCENTS = ["#2b45c8", "#d97a0b", "#178a4c", "#7c3aed", "#0e7490", "#db2777", "#b45309", "#4d7c0f"];
const WARM_ACCENTS = ["#2b45c8", "#d97a0b", "#178a4c", "#7c3aed", "#0e7490", "#db2777"];

function diffBadge(d) {
  return '<span class="badge ' + (d === "easy" ? "pass" : d === "medium" ? "target" : "error") + '">' + diffLabel(d) + "</span>";
}
function bestPill(st) {
  return st.best ? '<span class="pillStat">' + st.best.net + " WPM · " + (+st.best.acc).toFixed(1) + "%</span>" : "";
}
/* durSummaryHtml — verbatim: which durations this item was completed at. */
function durSummary(id) {
  const map = loadBest();
  const arr = Array.isArray(map[id]) ? map[id] : [];
  if (!arr.length) return "";
  const done = {};
  arr.forEach(function (en) { if (en && en.min) done[en.min] = true; });
  const parts = [1, 2, 5, 10, 15].map(function (d) {
    return done[d] ? "<span style='color:var(--pass);font-weight:800'>" + d + " min ✓</span>"
      : "<span style='color:var(--muted)'>" + d + " min ·</span>";
  });
  return "<span class='bestLine'>Completed at: " + parts.join(" ") + "</span>";
}
/* Old lessonRow status line: completed / attempts / gate / best. */
function statusLine(it) {
  const st = lessonStatus(it.id);
  return (st.completed ? "✓ Completed" : (st.attempts ? "In progress" : "Not attempted"))
    + (st.attempts ? " · " + st.attempts + " attempt" + (st.attempts > 1 ? "s" : "") : "")
    + (st.passed ? " · ✅ 98% gate passed" : "")
    + (st.best ? " · Best: " + st.best.net + " WPM · " + (+st.best.acc).toFixed(1) + "%" : "");
}

/* =====================================================================
   Numbers drill — live finger hints (verbatim port of the old panel:
   NUM_FINGER / NUM_LETTER_FINGER / updateNumHint / flashNumKey and the
   capture keydown coach). The panel is injected under the typing area
   of the shared stage and driven by the stage's live state. */
const NUM_FINGER = {
  "1": { cls: "fp", name: "Left little finger" }, "2": { cls: "fr", name: "Left ring finger" },
  "3": { cls: "fm", name: "Left middle finger" }, "4": { cls: "fi", name: "Left index finger" },
  "5": { cls: "fi", name: "Left index finger" }, "6": { cls: "fi", name: "Right index finger" },
  "7": { cls: "fi", name: "Right index finger" }, "8": { cls: "fm", name: "Right middle finger" },
  "9": { cls: "fr", name: "Right ring finger" }, "0": { cls: "fp", name: "Right little finger" }
};
const NUM_LETTER_FINGER = (function () {
  const groups = [["qaz", "fp", "Left little finger"], ["wsx", "fr", "Left ring finger"], ["edc", "fm", "Left middle finger"], ["rfvtgb", "fi", "Left index finger"],
    ["yhnujm", "fi", "Right index finger"], ["ik", "fm", "Right middle finger"], ["ol", "fr", "Right ring finger"], ["p", "fp", "Right little finger"]];
  const map = {};
  groups.forEach(function (g) { g[0].split("").forEach(function (ch) { map[ch] = { cls: g[1], name: g[2] }; }); });
  return map;
})();
function numFingerFor(ch) {
  if (!ch) return null;
  if (ch === " ") return { cls: "", name: "Thumb (either)" };
  if (NUM_FINGER[ch]) return NUM_FINGER[ch];
  return NUM_LETTER_FINGER[ch.toLowerCase()] || null;
}
function numFingerDot(cls) {
  return { "fp": "rgba(219,39,119,.85)", "fr": "rgba(234,88,12,.9)", "fm": "rgba(202,138,4,.95)", "fi": "rgba(43,69,200,.85)" }[cls] || "var(--muted)";
}
function numHintsOn() { return SETTINGS.numHints !== false; }
const NUM_PANEL_HTML =
  '<div id="numHint" style="display:none">' +
    '<div class="numHintBar">' +
      '<div class="numHintInfo" id="numHintInfo">' +
        '<span class="numNext"><span class="numNextLabel">Next</span><span class="numNextKey" id="numNextKey">4</span></span>' +
        '<span class="numFinger"><span class="dot" id="numFingerDot"></span><span id="numFingerName">Left index finger</span></span>' +
        '<span class="numHintMsg" id="numHintMsg" role="status"></span>' +
      '</div>' +
      '<button class="pill" id="numHintToggle" type="button" aria-pressed="true">Finger hints · On</button>' +
    '</div>' +
    '<div class="numKb" id="numKb"></div>' +
  '</div>';

function createNumHint() {
  let handle = null, slot = null, root = null, built = false, poll = null, lastSig = "";
  function isNum() { return !!(handle && /^num[1-6]$/.test(handle._state.currentId || "")); }
  function update() {
    if (!root || !handle) return;
    const S = handle._state;
    if (!isNum()) { root.style.display = "none"; return; }
    root.style.display = "";
    const on = numHintsOn();
    const tog = root.querySelector("#numHintToggle");
    if (tog) { tog.textContent = "Finger hints · " + (on ? "On" : "Off"); tog.classList.toggle("active", on); tog.setAttribute("aria-pressed", on ? "true" : "false"); }
    const kb = root.querySelector("#numKb"); if (kb) kb.style.display = on ? "" : "none";
    const info = root.querySelector("#numHintInfo"); if (info) info.style.display = on ? "" : "none";
    if (!on) return;
    if (!built && kb) {
      let hh = "";
      "1234567890".split("").forEach(function (d) { hh += "<div class='key " + NUM_FINGER[d].cls + "' data-nk='" + d + "'>" + d + "</div>"; });
      hh += "<div class='key space' data-nk=' '>SPACE — thumbs</div>";
      kb.innerHTML = hh;
      built = true;
    }
    const pos = Math.max(0, Math.min(S.caret || 0, S.typed.length));
    const next = pos < S.target.length ? S.target[pos] : "";
    const chip = root.querySelector("#numNextKey"), fname = root.querySelector("#numFingerName"), dot = root.querySelector("#numFingerDot");
    if (S.finished || !next) {
      if (chip) chip.textContent = "✓";
      if (fname) fname.textContent = S.finished ? "Lesson finished" : "Text complete";
      if (dot) dot.style.background = "var(--pass)";
    } else {
      if (chip) chip.textContent = next === " " ? "Space" : next;
      const f = numFingerFor(next);
      if (fname) fname.textContent = f ? f.name : "Next key";
      if (dot) dot.style.background = f ? numFingerDot(f.cls) : "var(--muted)";
    }
    if (kb) {
      kb.querySelectorAll(".key.next").forEach(function (k) { k.classList.remove("next"); });
      if (next && !S.finished) {
        const sel = kb.querySelector("[data-nk='" + next + "']");
        if (sel) sel.classList.add("next");
      }
    }
  }
  function flash(ch, kind) {
    if (!root || !numHintsOn()) return;
    const kbEl = root.querySelector("#numKb"); if (!kbEl) return;
    const sel = kbEl.querySelector("[data-nk='" + ch + "']"); if (!sel) return;
    sel.classList.remove("wrong", "hit");
    void sel.offsetWidth;
    sel.classList.add(kind);
    setTimeout(function () { sel.classList.remove(kind); }, kind === "wrong" ? 480 : 200);
  }
  function onKey(e) {
    if (!handle || !root) return;
    if (!e.target || e.target.id !== "capture") return;
    const S = handle._state;
    if (!isNum() || S.finished || !numHintsOn()) return;
    if (!e.key || e.key.length !== 1) return;
    const pos = Math.max(0, Math.min(S.caret || 0, S.typed.length));
    const exp = S.target[pos];
    if (exp === undefined) return;
    if (e.key === exp) {
      if (NUM_FINGER[e.key] || e.key === " ") flash(e.key, "hit");
    } else {
      if (NUM_FINGER[e.key] || e.key === " ") flash(e.key, "wrong");
      const msg = root.querySelector("#numHintMsg");
      if (msg) {
        const f = numFingerFor(exp);
        msg.textContent = "That was " + (e.key === " " ? "Space" : e.key) + " — next is " + (exp === " " ? "Space" : exp) + (f ? " (" + f.name.toLowerCase() + ")" : "");
        setTimeout(function () { msg.textContent = ""; }, 1600);
      }
    }
  }
  function onClick() { requestAnimationFrame(update); }
  function attach(slotEl, stageHandle) {
    detach();
    handle = stageHandle; slot = slotEl;
    const area = slotEl.querySelector("#typeArea");
    if (!area) return;
    area.insertAdjacentHTML("afterend", NUM_PANEL_HTML);
    root = slotEl.querySelector("#numHint");
    built = false;
    slotEl.addEventListener("input", update);
    slotEl.addEventListener("keydown", onKey);
    slotEl.addEventListener("click", onClick);
    const tog = root.querySelector("#numHintToggle");
    if (tog) tog.addEventListener("click", function () {
      SETTINGS.numHints = !numHintsOn();
      persistSettings();
      update();
      const cap = slotEl.querySelector("#capture");
      if (cap) { try { cap.focus({ preventScroll: true }); } catch (e) { cap.focus(); } }
    });
    /* Backstop for lesson switches that fire no input/click inside the
       slot (passage-picker picks happen in a body-level modal). */
    poll = setInterval(function () {
      if (!handle) return;
      const S = handle._state;
      const sig = (S.currentId || "") + "|" + (S.caret || 0) + "|" + S.typed.length + "|" + S.finished + "|" + numHintsOn();
      if (sig !== lastSig) { lastSig = sig; update(); }
    }, 300);
    update();
  }
  function detach() {
    if (poll) { clearInterval(poll); poll = null; }
    if (slot) {
      slot.removeEventListener("input", update);
      slot.removeEventListener("keydown", onKey);
      slot.removeEventListener("click", onClick);
    }
    handle = null; slot = null; root = null; built = false; lastSig = "";
  }
  return { attach: attach, detach: detach };
}

/* ===================================================================== */
export function mount(container) {
  let tab = "warmup";
  let openWarmSet = null;
  let openCats = { 0: true };
  let diffFilter = "all";
  let stage = null;
  const numHint = createNumHint();

  function killStage() {
    if (stage) { try { stage.destroy(); } catch (e) {} stage = null; }
    numHint.detach();
  }

  /* One launch path for every practice context (old launchers' shape):
     a silo the picker/Next are confined to, practice personality, and
     onExit returning to the list the launch came from. mode:"custom"
     keeps the command bar's Backspace toggle free in the Studio
     (resolution 2); the duration is fixed by the launcher, as before. */
  function launchStage(stageOpts, backFn) {
    killStage();
    container.innerHTML = "";
    const slot = document.createElement("div");
    slot.className = "practiceStage";
    container.appendChild(slot);
    stage = mountPracticeStage(slot, Object.assign({}, stageOpts, {
      mode: "custom",
      onExit: function () { killStage(); backFn(); },
      onFinish: function () {}
    }));
    numHint.attach(slot, stage);
    if (stage && stage.focus) stage.focus();
    window.scrollTo(0, 0);
  }

  /* ---------------- shell ---------------- */
  function render() {
    killStage();
    container.innerHTML =
      '<section class="arena-head"><h1>Training Studio</h1>' +
      '<p>Daily skill building — warm-ups, drills and themed practice. Serious testing lives in the Exam Arena.</p></section>' +
      '<div class="studio-tabs" role="tablist">' +
        TABS.map(function (t) {
          return '<button type="button" role="tab" data-tab="' + t.id + '" class="' + (t.id === tab ? "active" : "") + '">' + t.label + "</button>";
        }).join("") +
      "</div>" +
      '<div id="studioBody"></div>';
    container.querySelectorAll("[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () { tab = b.getAttribute("data-tab"); render(); });
    });
    renderTab();
  }
  function renderTab() {
    container.querySelectorAll("[data-tab]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });
    const body = container.querySelector("#studioBody");
    if (!body) return;
    if (tab === "warmup") renderWarmups(body);
    else if (tab === "drills") renderDrills(body);
    else renderTheme(body);
  }

  /* ---------------- Warm-Up ---------------- */
  function doneToday(w) {
    const today = new Date().toDateString();
    const best = loadBest();
    for (let i = 0; i < w.subsets.length; i++) {
      const arr = Array.isArray(best[w.subsets[i].id]) ? best[w.subsets[i].id] : [];
      for (let j = 0; j < arr.length; j++) {
        const t = entryTs(arr[j]);
        if (t && new Date(t).toDateString() === today) return true;
      }
    }
    const prefix = "Warm-Up · " + w.name + " — Subset ";
    return loadHist().some(function (x) {
      return x.name && x.name.indexOf(prefix) === 0 && new Date(entryTs(x)).toDateString() === today;
    });
  }
  function renderWarmups(body) {
    if (openWarmSet) {
      const w = warmupSet(openWarmSet);
      if (w) { renderWarmSet(body, w); return; }
      openWarmSet = null;
    }
    body.innerHTML = '<div class="wu-grid">' + WARMUPS.map(function (w, wi) {
      const done = w.subsets.filter(function (s) { return lessonStatus(s.id).completed; }).length;
      const filled = Math.round(done / w.subsets.length * 5);
      let segs = "";
      for (let i = 0; i < 5; i++) segs += '<span class="wu-seg' + (i < filled ? " on" : "") + '"></span>';
      return '<button type="button" class="wu-card" data-wu="' + w.id + '" style="--acc:' + WARM_ACCENTS[wi % WARM_ACCENTS.length] + '">' +
        '<span class="wu-top"><span class="pillStat">15-Min Warm-Up</span>' + diffBadge(w.level) +
          (doneToday(w) ? '<span class="badge pass">Done Today ✓</span>' : "") + "</span>" +
        '<strong class="wu-name">' + escapeHtml(w.name) + "</strong>" +
        '<span class="wu-desc">' + escapeHtml(w.desc) + "</span>" +
        '<span class="wu-strip" aria-hidden="true">' + segs + "</span>" +
        '<span class="wu-meta">' + done + " / " + w.subsets.length + " subsets done · Open set →</span>" +
      "</button>";
    }).join("") + "</div>";
    body.querySelectorAll("[data-wu]").forEach(function (b) {
      b.addEventListener("click", function () { openWarmSet = b.getAttribute("data-wu"); renderTab(); window.scrollTo(0, 0); });
    });
  }
  function renderWarmSet(body, w) {
    let h = '<div class="controls" style="margin-bottom:12px"><button class="pill" id="warmBack" type="button">← All sets</button>' +
      '<strong style="font-size:15px">' + escapeHtml(w.name) + "</strong>" + diffBadge(w.level) +
      '<span class="small">' + w.subsets.length + " subsets · 15 min each</span></div>" + '<div class="card">';
    w.subsets.forEach(function (sub) {
      const st = lessonStatus(sub.id);
      const meta = wordCountOf(sub.text) + " words"
        + (st.completed ? " · ✓ Completed" : " · Not completed")
        + (st.passed ? " · ✅ 98% gate passed" : "")
        + (st.best ? " · Best " + st.best.net + " WPM · " + (+st.best.acc).toFixed(1) + "%" : "")
        + (st.attempts ? " · " + st.attempts + " attempt" + (st.attempts > 1 ? "s" : "") : "");
      h += "<div class='testRow'><span class='trNum'>" + sub.n + "</span><span class='trMain'><strong>Subset " + sub.n + "</strong>"
        + (sub.topic ? "<span class='trTopic'>" + escapeHtml(sub.topic) + "</span>" : "")
        + "<span>" + escapeHtml(meta) + "</span></span>" + diffBadge(w.level)
        + "<span class='trAct'><button class='btn' data-wsub='" + sub.id + "' type='button'>" + (st.completed ? "Retake" : "Start") + " →</button></span></div>";
    });
    h += "</div>";
    body.innerHTML = h;
    body.querySelector("#warmBack").addEventListener("click", function () { openWarmSet = null; renderTab(); });
    body.querySelectorAll("[data-wsub]").forEach(function (b) {
      b.addEventListener("click", function () {
        const sub = w.subsets.find(function (x) { return x.id === b.getAttribute("data-wsub"); });
        if (sub) startWarmSubset(w, sub);
      });
    });
  }
  function startWarmSubset(w, sub) {
    const silo = {
      key: "warm:" + w.id, capSec: 15 * 60, index: sub.n - 1,
      items: w.subsets.map(function (sb) {
        return { id: sb.id, name: "Warm-Up · " + w.name + " — Subset " + sb.n, text: sb.text, isDrill: true };
      })
    };
    launchStage({ silo: silo, durMin: 15, title: "15-Min Warm-Up" }, function () {
      tab = "warmup"; openWarmSet = w.id; render();
    });
  }

  /* ---------------- Skill Drills ---------------- */
  function lessonCard(it, pi, ii) {
    const st = lessonStatus(it.id);
    const d = DIFF[it.id] || "medium";
    const state = st.passed ? "mastered" : st.completed ? "attempted" : "fresh";
    const dot = d === "easy" ? "var(--pass)" : d === "medium" ? "var(--target)" : "var(--error)";
    let foot;
    if (st.passed) foot = '<span class="badge pass">✓ Mastered</span>' + bestPill(st);
    else if (st.completed) foot = '<span class="badge target">Retry</span>' + bestPill(st);
    else foot = '<span class="lc-start">Start →</span>';
    return '<button type="button" class="lesson-card st-' + state + '" data-drill="' + it.id + '" data-pi="' + pi + '" data-ii="' + ii + '" data-diff="' + d + '">' +
      '<span class="lc-top"><span class="lc-dot" style="--dot:' + dot + '"></span><span class="lc-diff">' + diffLabel(d) + "</span>" +
        (st.passed ? '<span class="lc-check" aria-hidden="true">✓</span>' : "") + "</span>" +
      '<span class="lc-name">' + escapeHtml(it.name) + "</span>" +
      (it.desc ? '<span class="lc-desc">' + escapeHtml(it.desc) + "</span>" : "") +
      '<span class="lc-foot">' + foot + "</span></button>";
  }
  function renderDrills(body) {
    const total = DRILLS.reduce(function (a, p) { return a + p.items.length; }, 0);
    let masteredCount = 0, nextPi = -1, nextIi = -1;
    DRILLS.forEach(function (p, pi) {
      p.items.forEach(function (it, ii) {
        if (lessonStatus(it.id).passed) masteredCount++;
        else if (nextPi < 0) { nextPi = pi; nextIi = ii; }
      });
    });
    const nextIt = nextPi >= 0 ? DRILLS[nextPi].items[nextIi] : null;
    let h = '<div class="card mastery-head">' +
      '<div class="mh-top"><div>' +
        '<div class="mh-big">' + masteredCount + " / " + total + " <span>Drills Mastered</span></div>" +
        '<p class="small" style="margin:4px 0 0">' + DRILLS.length + " modules · " + total + " lessons · 98% Accuracy Gate</p></div>" +
        (nextIt
          ? '<button class="btn" type="button" id="continueDrill" data-continue="' + nextIt.id + '" data-pi="' + nextPi + '" data-ii="' + nextIi + '">Continue Next Drill →<span class="mh-next-name">' + escapeHtml(nextIt.name) + "</span></button>"
          : '<span class="badge pass">All drills mastered 🎉</span>') +
      "</div>" +
      '<div class="prog mh-bar"><i style="width:' + (total ? (masteredCount / total * 100) : 0) + '%"></i></div>' +
      '<div class="controls" style="margin:12px 0 0">' +
        ["all", "easy", "medium", "hard"].map(function (d) {
          return '<button class="pill diffF' + (diffFilter === d ? " active" : "") + '" type="button" data-diff="' + d + '">' + (d === "all" ? "All" : diffLabel(d)) + "</button>";
        }).join("") +
      "</div></div>";
    DRILLS.forEach(function (part, pi) {
      const vis = [];
      part.items.forEach(function (it, ii) {
        if (diffFilter === "all" || (DIFF[it.id] || "medium") === diffFilter) vis.push({ it: it, ii: ii });
      });
      if (!vis.length) return;   /* a part with zero matches hides entirely (old applyDiffFilter choice) */
      const mCount = part.items.filter(function (it) { return lessonStatus(it.id).passed; }).length;
      h += '<section class="mod-sec"><div class="mod-head">' +
        '<span class="accDot" style="--acc:' + PART_ACCENTS[pi % PART_ACCENTS.length] + '"></span>' +
        "<h3>" + escapeHtml(part.part) + '</h3><span class="mod-count">' + mCount + " / " + part.items.length + " Mastered</span></div>" +
        '<div class="prog mod-bar"><i style="width:' + (part.items.length ? (mCount / part.items.length * 100) : 0) + '%"></i></div>' +
        '<div class="lesson-grid">' + vis.map(function (x) { return lessonCard(x.it, pi, x.ii); }).join("") + "</div></section>";
    });
    body.innerHTML = h;
    const cont = body.querySelector("#continueDrill");
    if (cont) cont.addEventListener("click", function () { startDrill(+cont.getAttribute("data-pi"), +cont.getAttribute("data-ii")); });
    body.querySelectorAll(".diffF").forEach(function (b) {
      b.addEventListener("click", function () { diffFilter = b.getAttribute("data-diff"); renderTab(); });
    });
    body.querySelectorAll("[data-drill]").forEach(function (b) {
      b.addEventListener("click", function () { startDrill(+b.getAttribute("data-pi"), +b.getAttribute("data-ii")); });
    });
  }
  function startDrill(pi, ii) {
    const part = DRILLS[pi];
    if (!part || !part.items[ii]) return;
    const silo = {
      key: "drill:" + pi, index: ii,
      items: part.items.map(function (it) {
        return { id: it.id, name: it.name, text: it.text, isDrill: it.id.indexOf("para") !== 0 };
      })
    };
    launchStage({ silo: silo, title: "Skill Drills" }, function () { tab = "drills"; render(); });
  }

  /* ---------------- Theme Practice ---------------- */
  function libItems() {
    const seen = {}, items = [];
    SESSION_CATS.forEach(function (cat) {
      cat.ids.forEach(function (id) {
        if (seen[id]) return;
        const it = textById(id);
        if (it) { seen[id] = 1; items.push({ id: it.id, name: it.name, text: it.text, isDrill: it.id.indexOf("para") !== 0 }); }
      });
    });
    return items;
  }
  function renderTheme(body) {
    let h = '<div class="card theme-top"><h2>' + icon("keyboard") + ' Free Typing Test</h2>' +
      '<p class="sub">The whole practice library on one stage — switch passages any time with the Passage picker on the typing stage.</p>' +
      '<button class="btn" type="button" id="freeTestBtn">Start Typing Test →</button></div>';
    h += '<div class="card"><h2>Paste &amp; practise</h2>' +
      '<div class="field"><textarea id="pasteText" rows="4" placeholder="Paste any text here and practise it — unscored…"></textarea></div>' +
      '<div class="controls" style="margin:0"><button class="btn secondary" type="button" id="pasteGo">Load this text</button>' +
      '<span class="form-msg" id="pasteMsg"></span></div></div>';
    SESSION_CATS.forEach(function (cat, ci) {
      const items = cat.ids.map(function (id) { return textById(id); }).filter(Boolean);
      if (!items.length) return;
      const open = !!openCats[ci];
      h += "<div class='catCard" + (open ? " open" : "") + "'><button type='button' class='catHead' data-cat='" + ci + "'><strong>" + escapeHtml(cat.title) + "</strong>" +
        "<span class='catCount'>" + items.length + " lesson" + (items.length > 1 ? "s" : "") + "</span><span class='chev'>" + (open ? "▾" : "▸") + "</span></button>"
        + (cat.desc ? "<p class='catDesc'>" + escapeHtml(cat.desc) + "</p>" : "");
      if (open) {
        h += "<div class='catRows'>";
        items.forEach(function (it, i) {
          const d = DIFF[it.id] || "medium";
          h += "<div class='testRow'><span class='trNum'>" + (i + 1) + "</span><span class='trMain'><strong>" + escapeHtml(it.name) + "</strong>"
            + (it.desc ? "<span class='trTopic'>" + escapeHtml(it.desc) + "</span>" : "")
            + "<span>" + escapeHtml(statusLine(it)) + "</span>" + durSummary(it.id) + "</span>" + diffBadge(d)
            + "<span class='trAct'><button class='btn' data-catstart='" + ci + ":" + i + "' type='button'>Start →</button></span></div>";
        });
        h += "</div>";
      }
      h += "</div>";
    });
    body.innerHTML = h;
    body.querySelector("#freeTestBtn").addEventListener("click", startFreeTest);
    body.querySelector("#pasteGo").addEventListener("click", function () {
      const ta = body.querySelector("#pasteText"), msg = body.querySelector("#pasteMsg");
      const text = (ta ? ta.value : "").replace(/\s+/g, " ").trim();
      if (text.length < 20) {
        if (msg) { msg.textContent = "Paste a little more text first — at least a sentence or two (20+ characters)."; msg.style.color = "var(--error)"; }
        return;
      }
      launchStage({
        silo: { key: "paste", items: [{ id: "customText", name: "Custom text", text: text, isDrill: false }], index: 0 },
        title: "Paste & practise"
      }, function () { tab = "theme"; render(); });
    });
    body.querySelectorAll(".catHead").forEach(function (b) {
      b.addEventListener("click", function () {
        const ci = +b.getAttribute("data-cat");
        openCats[ci] = !openCats[ci];
        renderTab();
      });
    });
    body.querySelectorAll("[data-catstart]").forEach(function (b) {
      b.addEventListener("click", function () {
        const parts = b.getAttribute("data-catstart").split(":");
        startCatItem(+parts[0], +parts[1]);
      });
    });
  }
  function startFreeTest() {
    const items = libItems();
    if (!items.length) return;
    let idx = 0;
    items.forEach(function (it, i) { if (it.id === "paraM1") idx = i; });
    launchStage({ silo: { key: "lib", items: items, index: idx }, title: "Typing Test" }, function () {
      tab = "theme"; render();
    });
  }
  function startCatItem(ci, idx) {
    const cat = SESSION_CATS[ci];
    if (!cat) return;
    const items = cat.ids.map(function (id) { return textById(id); }).filter(Boolean)
      .map(function (it) { return { id: it.id, name: it.name, text: it.text, isDrill: it.id.indexOf("para") !== 0 }; });
    if (!items.length || !items[idx]) return;
    launchStage({ silo: { key: "cat:" + ci, items: items, index: idx }, title: "Theme Practice" }, function () {
      tab = "theme"; openCats[ci] = true; render();
    });
  }

  render();
  return { destroy: function () { killStage(); } };
}
