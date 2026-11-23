/* components/FloatingCommandBar.js — the single Floating Command Pill
   (prompt §4). SHELL-GRADE in Stage 1: a controlled component that renders
   the bar and reports actions; Stage 2 wires it to the typing engine.
   Layout: [Exam Selector ▾] | [1m·2m·5m·10m·15m] | [Passage Picker ▾] |
   [Paper View] | [Backspace: ON/OFF] | [Live Errors: ON/OFF] | [⚙ More].
   Resolutions baked in: auto-submit is NOT offered (sid's rule — manual
   submit stays); the Backspace toggle is disabled/locked only where the
   stage's rules fix it, with the state still visible. */

import { icon } from "./icons.js";
import { escapeHtml } from "./ProfilePopover.js";

export const COMMAND_DURATIONS = [1, 2, 5, 10, 15];

/* opts: { examLabel, duration, backspace, backspaceLocked, liveErrors,
          paperView, onAction(name, value) } */
export function renderCommandBar(opts) {
  opts = opts || {};
  const bar = document.createElement("div");
  bar.className = "command-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Test options");
  const bsLocked = !!opts.backspaceLocked;
  bar.innerHTML =
    '<button class="cb-btn" type="button" data-act="exam">' + icon("arena") + escapeHtml(opts.examLabel || "Exam") + icon("chevD") + '</button>' +
    '<span class="cb-sep"></span>' +
    '<span class="cb-durs" role="group" aria-label="Duration">' +
      COMMAND_DURATIONS.map(function (d) {
        return '<button type="button" data-act="duration" data-v="' + d + '" class="' + (opts.duration === d ? "active" : "") + '">' + d + 'm</button>';
      }).join("") +
    '</span>' +
    '<span class="cb-sep"></span>' +
    '<button class="cb-btn" type="button" data-act="passage">' + icon("book") + 'Passage' + icon("chevD") + '</button>' +
    '<button class="cb-btn' + (opts.paperView ? " on" : "") + '" type="button" data-act="paper" aria-pressed="' + !!opts.paperView + '">' + icon("file") + 'Paper View</button>' +
    '<button class="cb-btn' + (opts.backspace ? " on" : "") + '" type="button" data-act="backspace" aria-pressed="' + !!opts.backspace + '"' + (bsLocked ? ' disabled data-tip="Fixed by this exam\'s official rule"' : "") + '>⌫ Backspace: ' + (opts.backspace ? "ON" : "OFF") + '</button>' +
    '<button class="cb-btn' + (opts.liveErrors ? " on" : "") + '" type="button" data-act="errors" aria-pressed="' + !!opts.liveErrors + '">' + icon("eye") + 'Live Errors: ' + (opts.liveErrors ? "ON" : "OFF") + '</button>' +
    '<span class="cb-sep"></span>' +
    '<button class="cb-btn" type="button" data-act="more" aria-label="More options">' + icon("gear") + 'More</button>';
  bar.addEventListener("click", function (e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    if (typeof opts.onAction === "function") {
      opts.onAction(b.getAttribute("data-act"), b.getAttribute("data-v"));
    }
  });
  return bar;
}
