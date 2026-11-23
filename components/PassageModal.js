/* components/PassageModal.js — searchable Passage Picker Modal (prompt §4).
   SHELL-GRADE in Stage 1: open/close, search filtering, grouped rendering
   with difficulty tags + completion checkmarks.
   SILO RULE (sid, 14 Nov — resolution 1): the caller passes ONLY the
   current area's texts (one exam hub, one warm-up set, one drill part…).
   This component never reaches across silos and never imports the full
   library itself. */

import { icon } from "./icons.js";
import { escapeHtml } from "./ProfilePopover.js";
import { diffLabel } from "../data/drills.js";

let backdrop = null;

/* opts: { title, groups: [{ label, items: [{ id, name, sub, diff, done }] }],
          onPick(item) } */
export function openPassageModal(opts) {
  closePassageModal();
  backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop open";
  backdrop.innerHTML =
    '<div class="modal wide" role="dialog" aria-modal="true" aria-label="Choose a passage">' +
      '<div class="modal-head"><h2>' + escapeHtml(opts.title || "Choose a passage") + '</h2>' +
      '<button class="icon-btn" type="button" data-close aria-label="Close">' + icon("x") + '</button></div>' +
      '<div class="field pm-search"><input class="text-input" type="search" placeholder="Search passages…" aria-label="Search passages" id="pmSearch"></div>' +
      '<div id="pmList"></div>' +
    '</div>';
  document.body.appendChild(backdrop);

  const list = backdrop.querySelector("#pmList");
  function render(q) {
    const query = (q || "").toLowerCase();
    list.innerHTML = (opts.groups || []).map(function (g) {
      const items = (g.items || []).filter(function (it) {
        return !query || (it.name + " " + (it.sub || "")).toLowerCase().indexOf(query) >= 0;
      });
      if (!items.length) return "";
      return '<div class="pm-group">' + escapeHtml(g.label) + '</div>' + items.map(function (it) {
        return '<button class="pm-item" type="button" data-id="' + escapeHtml(it.id) + '">' +
          '<span class="pm-main"><span class="pm-name">' + escapeHtml(it.name) + '</span>' +
          (it.sub ? '<span class="pm-sub">' + escapeHtml(it.sub) + '</span>' : "") + '</span>' +
          (it.diff ? '<span class="badge ' + (it.diff === "easy" ? "pass" : it.diff === "medium" ? "target" : "error") + '">' + diffLabel(it.diff) + '</span>' : "") +
          (it.done ? '<span class="pm-check" title="Completed">✓</span>' : "") +
        '</button>';
      }).join("");
    }).join("") || '<p class="muted">No passages match.</p>';
    list.querySelectorAll(".pm-item").forEach(function (b) {
      b.addEventListener("click", function () {
        const id = b.getAttribute("data-id");
        let found = null;
        (opts.groups || []).forEach(function (g) {
          (g.items || []).forEach(function (it) { if (it.id === id) found = it; });
        });
        closePassageModal();
        if (found && typeof opts.onPick === "function") opts.onPick(found);
      });
    });
  }
  render("");
  backdrop.querySelector("#pmSearch").addEventListener("input", function (e) { render(e.target.value); });
  backdrop.querySelector("[data-close]").addEventListener("click", closePassageModal);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closePassageModal(); });
  const s = backdrop.querySelector("#pmSearch");
  if (s) s.focus();
}

export function closePassageModal() {
  if (backdrop) { backdrop.remove(); backdrop = null; }
}
