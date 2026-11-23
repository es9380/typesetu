/* features/progress/revision.js — the Revision feature (Stage 3).
   Bank policy lives in core/forensics.js (revFeed / revApplyResult /
   revDueList / revMergeBanks — verbatim ports of the current app).
   This module owns what Stage 3 was assigned:
   - the login-time cloud merge (revCloudSync — verbatim policy from
     forensics-revision.js) registered into firebaseService's open hook,
   - revision session composition + application (revComposeStream /
     revStreamApply — verbatim), and the "Practise My Mistakes" word
     selection (launchResultDrill policy — verbatim from
     revision-drills.js),
   - the Revision section UI (renderRevisionInto — a verbatim port of
     renderRevision) rendered by Progress; the typing stage itself is
     mounted by the caller via onStartSession(words).
   The old sidebar/drawer due-badges (paintRevBadges) have no chrome to
   attach to in the redesign header; the due counts live in this
   section, and core/forensics.js revSave emits "revision" so a mounted
   Progress re-renders on every bank change. */

import {
  revLoad, revSave, revApplyResult, revDueList, revFeed, revBankKey,
  storedMistakeDetail, revMergeBanks, revToday, revAddDays
} from "../../core/forensics.js";
import { alignWordsHcm, hcmWordTokens } from "../../core/scoringMatrix.js";
import { specOf } from "../../data/exams.js";
import { appState } from "../../core/state.js";
import { escapeHtml } from "../../components/ProfilePopover.js";
import {
  readRevisionCloud, writeRevisionCloud, registerRevisionSync
} from "../../services/firebaseService.js";

export { revLoad, revDueList };

/* ---------------- login-time cloud merge (revCloudSync) ----------------
   Verbatim policy: read the cloud bank; if it exists, merge it with the
   local bank (further-along stage wins per word), save the merge
   locally and write it back; if it does not exist, push the local bank
   up. The redesign's revSave already performs the local write, emits
   "revision" and schedules the debounced cloud write-back. */
export function revCloudSync() {
  if (!appState.user) return Promise.resolve(false);
  return readRevisionCloud().then(function (cv) {
    const local = revLoad();
    if (cv && Array.isArray(cv.words)) {
      const merged = revMergeBanks(local, { words: cv.words, updatedAt: cv.updatedAt || null });
      revSave(merged);
      return true;
    }
    return writeRevisionCloud(local).then(function () { return true; });
  }).catch(function () { return false; });
}

let hookRegistered = false;
export function registerRevisionSyncHook() {
  if (hookRegistered) return;
  hookRegistered = true;
  try { registerRevisionSync(function () { return revCloudSync(); }); } catch (e) {}
}

/* ------------- Practise-My-Mistakes pending intent -------------
   Arena's result screens route here; the entry they belonged to is
   handed over through this slot (Stage 2's arena passes the entry, or
   the just-finished entry's clientId via window.__lastEntryClientId). */
let pendingMistakeClientId = null;
export function setPendingMistakeEntry(clientId) { pendingMistakeClientId = clientId || null; }
export function consumePendingMistakeEntry() {
  const id = pendingMistakeClientId;
  pendingMistakeClientId = null;
  return id;
}

/* ---------------- session composition (verbatim) ---------------- */
export function revComposeStream(wordsArray) {
  const ws = (wordsArray || []).slice(0, 18), out = [];
  let r, i;
  for (r = 0; r < 3; r++) for (i = 0; i < ws.length; i++) out.push(ws[i]);
  return out;
}

/* revStartStreamSession's word selection, minus the navigation: dedupe,
   cap 18, compose the ×3 interleaved stream. Returns null when empty. */
let streamWords = [];
export function beginStreamSession(wordsArray) {
  const seen = {}, ws = [];
  (wordsArray || []).forEach(function (w) { if (w && !seen[w]) { seen[w] = 1; ws.push(w); } });
  const words = ws.slice(0, 18);
  if (!words.length) { streamWords = []; return null; }
  const stream = revComposeStream(words);
  if (!stream.length) { streamWords = []; return null; }
  streamWords = words.slice();
  revSummary = null;
  return { words: words, text: stream.join(" ") };
}
export function cancelStreamSession() { streamWords = []; }

/* revStreamApply — verbatim: a word passes only if all 3 occurrences in
   the stream were typed clean; any substitution/deletion of it fails
   it. Passed words climb the 1→3→7→16-day ladder (revApplyResult). */
let revSummary = null;
export function getRevSummary() { return revSummary; }
export function clearRevSummary() { revSummary = null; }
export function revStreamApply(target, typedStr) {
  const words = streamWords;
  streamWords = [];
  if (!words.length) return null;
  const res = alignWordsHcm(target || "", typedStr || "");
  const kindByTi = {};
  (res.pairs || []).forEach(function (p) { if (p.ti >= 0) kindByTi[p.ti] = p.kind; });
  const targets = hcmWordTokens(target || "").map(function (t) { return t.w; });
  const passed = [], failed = [];
  words.forEach(function (w) {
    let clean = 0, botched = false;
    targets.forEach(function (tw, ti) {
      if (tw !== w) return;
      const k = kindByTi[ti];
      if (k === "ok") clean++;
      else if (k === "sub" || k === "del") botched = true;
    });
    if (botched) { revApplyResult(w, false); failed.push(w); }
    else if (clean >= 3) { revApplyResult(w, true); passed.push(w); }
  });
  revSummary = { passed: passed, failed: failed };
  return revSummary;
}

/* ---------------- Practise My Mistakes (verbatim policy) ----------------
   launchResultDrill: feed any of the entry's mistake words that are
   missing from the bank, then take the bank keys for the entry's words.
   startRevDrill: keep only words actually present in the bank. */
export function mistakeSessionWords(entry) {
  if (!entry) return [];
  const det = storedMistakeDetail(entry);
  if (!det.length) return [];
  const missing = det.filter(function (d) { return !revBankKey(d.exp); });
  if (missing.length) {
    try { revFeed(missing, entry.examId || "hcm"); }
    catch (e) { console.warn("Launch drill bank feed failed", e); }
  }
  const words = [];
  det.forEach(function (d) {
    const k = revBankKey(d.exp);
    if (k && words.indexOf(k) < 0) words.push(k);
  });
  return words;
}
export function bankWordsOnly(words) {
  const bank = revLoad(), ws = [], seen = {};
  (words || []).forEach(function (w) {
    if (!w || seen[w]) return;
    let e = null;
    bank.words.forEach(function (x) { if (x.word === w) e = x; });
    if (e) { seen[w] = 1; ws.push(e.word); }
  });
  return ws;
}

/* ---------------- Revision section UI (verbatim port) ---------------- */
export function revTypedForms(e) {
  const ks = Object.keys(e.typed || {}).sort(function (a, b) { return e.typed[b] - e.typed[a]; }).slice(0, 3);
  return ks.map(function (k) { return "“" + escapeHtml(k) + "” ×" + e.typed[k]; }).join(" · ");
}
export function revDueLabel(e) {
  const today = revToday();
  if (e.status === "mastered") return "Mastered";
  if (!e.nextDue) return "—";
  if (e.nextDue <= today) return "Due today";
  if (e.nextDue === revAddDays(today, 1)) return "Due tomorrow";
  return "Due " + e.nextDue;
}
export function revDueCount() { return revDueList(revLoad()).length; }

/* handlers: { onStartSession(words), rerender() } */
export function renderRevisionInto(wrap, handlers) {
  if (!wrap) return;
  const bank = revLoad(), due = revDueList(bank);
  const learning = bank.words.filter(function (x) { return x.status === "learning"; }).length;
  const mastered = bank.words.filter(function (x) { return x.status === "mastered"; }).length;
  let h = "";
  if (revSummary) {
    h += "<div class='card'><h2>Session complete</h2>"
      + "<p>Passed and moved up the ladder: <strong>" + revSummary.passed.length + "</strong> word" + (revSummary.passed.length === 1 ? "" : "s")
      + (revSummary.passed.length ? " (" + revSummary.passed.map(escapeHtml).join(", ") + ")" : "") + ".</p>"
      + "<p>Reset to the start (due again tomorrow): <strong>" + revSummary.failed.length + "</strong> word" + (revSummary.failed.length === 1 ? "" : "s")
      + (revSummary.failed.length ? " (" + revSummary.failed.map(escapeHtml).join(", ") + ")" : "") + ".</p>"
      + (due.length ? "<p><strong>" + due.length + "</strong> more word" + (due.length === 1 ? " is" : "s are") + " still due today.</p>"
        + "<div style='display:flex;gap:8px;flex-wrap:wrap'><button class='btn' id='revAgain' type='button'>↻ Practise this set again</button><button class='btn secondary' id='revSummaryOk' type='button'>Done</button></div></div>"
        : "<p>Nothing else is due today. 🎉</p>"
        + "<button class='btn secondary' id='revSummaryOk' type='button'>Done</button></div>");
  }
  if (!bank.words.length) {
    h += "<div class='card'><h2>No weak words yet</h2><p style='margin:0'>Finish any typing test and the words still wrong when it is scored collect here automatically, each with its next practice date. Words you fix with Backspace while typing never appear.</p></div>";
    wrap.innerHTML = h;
    wireSummary(wrap, handlers);
    return;
  }
  h += "<div class='revTiles'>"
    + "<div class='revTile'><div class='tv'>" + due.length + "</div><div class='tl'>Due today</div></div>"
    + "<div class='revTile'><div class='tv'>" + learning + "</div><div class='tl'>Still learning</div></div>"
    + "<div class='revTile'><div class='tv'>" + mastered + "</div><div class='tl'>Mastered</div></div></div>";
  if (due.length) {
    h += "<div class='card'><h2>Due today — " + due.length + " word" + (due.length === 1 ? "" : "s") + "</h2>"
      + "<p class='small'>Type the passage — each due word appears 3 times. Clean typing moves a word up the ladder (1 → 3 → 7 → 16 days); one mistake sends it back to tomorrow.</p>"
      + "<button class='btn big' id='revStart' type='button'>▶ Start revision session (" + Math.min(18, due.length) + " word" + (Math.min(18, due.length) === 1 ? "" : "s") + " · " + (Math.min(18, due.length) * 3) + " in the passage)</button>";
    const groups = {}, order = [];
    due.forEach(function (e) { const ex = (e.exams && e.exams[0]) || "hcm"; if (!groups[ex]) { groups[ex] = []; order.push(ex); } groups[ex].push(e); });
    order.forEach(function (ex) {
      const sp = specOf(ex);
      h += "<h3 style='margin-top:16px'>From " + (sp ? escapeHtml(sp.short) : ex) + "</h3>";
      groups[ex].forEach(function (e) {
        const forms = revTypedForms(e);
        h += "<div class='revDueRow'><span class='mono' style='font-size:17px'><strong>" + escapeHtml(e.word) + "</strong></span>"
          + (forms ? "<span class='small'>you typed " + forms + "</span>" : "")
          + "<span class='chip'>Stage " + e.stage + " of 3</span><span class='chip'>" + ((e.countFull || 0) + (e.countHalf || 0)) + " scored error" + (((e.countFull || 0) + (e.countHalf || 0)) === 1 ? "" : "s") + "</span>"
          + "<button class='btn secondary revDrillOne' data-word='" + encodeURIComponent(e.word) + "' type='button' style='margin-left:auto'>Start drill</button></div>";
      });
    });
    h += "</div>";
  } else {
    h += "<div class='card'><h2>Nothing due today 🎉</h2><p style='margin:0'>Your weak words are resting on their schedule — each one returns on its due date (1, 3, 7, then 16 days after its last clean pass). New scored mistakes from any test join the bank automatically." + (learning ? " You don't have to wait: any word still learning can be drilled right now — use its <strong>Drill</strong> button in your weak-word bank below, and a clean pass still moves it up the ladder." : "") + "</p></div>";
  }
  const all = bank.words.slice().sort(function (a, b) {
    const da = (a.status === "learning" && a.nextDue && a.nextDue <= revToday()) ? 0 : 1;
    const db = (b.status === "learning" && b.nextDue && b.nextDue <= revToday()) ? 0 : 1;
    if (da !== db) return da - db;
    return ((b.countFull || 0) + 0.5 * (b.countHalf || 0)) - ((a.countFull || 0) + 0.5 * (a.countHalf || 0));
  });
  h += "<div class='card'><h2>Your weak-word bank (" + bank.words.length + ")</h2><div style='overflow-x:auto'><table><tr><th>Word</th><th>You typed</th><th>Errors</th><th>Stage</th><th>Next due</th><th>Status</th><th>Drill</th></tr>";
  all.forEach(function (e) {
    h += "<tr><td class='mono'><strong>" + escapeHtml(e.word) + "</strong></td><td class='mono'>" + (revTypedForms(e) || "—") + "</td>"
      + "<td>" + (e.countFull || 0) + " full" + ((e.countHalf || 0) ? " · " + e.countHalf + " half" : "") + "</td>"
      + "<td>" + (e.status === "mastered" ? "—" : "Stage " + e.stage + " of 3") + "</td>"
      + "<td>" + revDueLabel(e) + "</td>"
      + "<td>" + (e.status === "mastered" ? "<strong style='color:var(--pass)'>Mastered ✓</strong>" : "Learning") + "</td>"
      + "<td>" + (e.status === "learning" ? "<button class='pill revDrillOne' data-word='" + encodeURIComponent(e.word) + "' type='button'>Drill</button>" : "—") + "</td></tr>";
  });
  h += "</table></div></div>";
  wrap.innerHTML = h;
  const st = wrap.querySelector("#revStart");
  if (st) st.addEventListener("click", function () {
    revSummary = null;
    handlers.onStartSession(revDueList(revLoad()).map(function (e) { return e.word; }));
  });
  wireSummary(wrap, handlers);
  wrap.querySelectorAll(".revDrillOne").forEach(function (b) {
    b.addEventListener("click", function () {
      let w = b.getAttribute("data-word") || "";
      try { w = decodeURIComponent(w); } catch (e) {}
      if (!w) return;
      const ws = bankWordsOnly([w]);
      if (ws.length) { revSummary = null; handlers.onStartSession(ws); }
    });
  });
}
function wireSummary(wrap, handlers) {
  const ok = wrap.querySelector("#revSummaryOk");
  if (ok) ok.addEventListener("click", function () { revSummary = null; handlers.rerender(); });
  const ag = wrap.querySelector("#revAgain");
  if (ag) ag.addEventListener("click", function () {
    revSummary = null;
    handlers.onStartSession(revDueList(revLoad()).map(function (e) { return e.word; }));
  });
}
