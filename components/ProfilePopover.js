/* components/ProfilePopover.js — the single Account Pill (prompt §2).
   Logged out: one clean "Sign In" button (opens AuthModal) — and NO name
   is shown anywhere (standing rule). Logged in: avatar/initials + name
   pill opening the popover: name with inline pencil edit, email,
   ● Cloud Synced status, actions (My Progress & History, Exam Guide &
   30-Day Plan, Backup JSON / Export CSV / Import), Sign Out footer. */

import { appState, on, emit } from "../core/state.js";
import { SETTINGS, persistSettings } from "../core/storage.js";
import { exportBackupJson, exportHistoryCsv, importBackupFile } from "../services/backup.js";
import { cloud } from "../services/cloudBridge.js";
import { openAuthModal } from "./AuthModal.js";
import { icon } from "./icons.js";

/* displayNameForUI — current semantics: signed-in only; account (cloud)
   name first, then the local settings name. Signed out → always "". */
export function displayNameForUI() {
  if (!appState.user) return "";
  const an = (appState.accountName || "").trim();
  if (an) return an;
  return (SETTINGS.name || "").trim();
}

const SYNC_LABELS = {
  synced: "● Cloud Synced",
  syncing: "● Syncing…",
  limited: "● Will sync automatically",
  failed: "● Sync failed — device results shown",
  local: "● On this device"
};
let syncState = "local";

export function mountProfilePopover(slot) {
  function close() {
    const p = slot.querySelector(".popover");
    if (p) p.classList.remove("open");
  }
  function render() {
    const user = appState.user;
    if (!user) {
      slot.innerHTML = '<button class="btn sm" id="signInBtn" type="button">Sign In</button>';
      slot.querySelector("#signInBtn").addEventListener("click", function () { openAuthModal("login"); });
      return;
    }
    const name = displayNameForUI();
    const initial = (name || user.email || "U").charAt(0).toUpperCase();
    slot.innerHTML =
      '<div class="account-wrap">' +
        '<button class="account-pill" id="acctPill" type="button" aria-haspopup="true" aria-expanded="false">' +
          '<span class="avatar" aria-hidden="true">' + initial + '</span>' +
          '<span class="ap-name">' + escapeHtml(name || user.email || "Your account") + '</span>' + icon("chevD") +
        '</button>' +
        '<div class="popover" id="acctPop" role="menu">' +
          '<div class="pop-head">' +
            '<span class="avatar" aria-hidden="true">' + initial + '</span>' +
            '<div style="min-width:0">' +
              '<div class="pop-name"><span id="popName">' + escapeHtml(name || "Your account") + '</span>' +
              '<button class="pencil" id="popEditName" type="button" aria-label="Edit name" data-tip="Edit name">' + icon("pencil") + '</button></div>' +
              '<div class="pop-email">' + escapeHtml(user.email || "") + '</div>' +
              '<span class="sync-pill' + (syncState === "synced" ? "" : " off") + '" id="popSync">' + (SYNC_LABELS[syncState] || SYNC_LABELS.local) + '</span>' +
              '<div class="name-edit-row" id="popNameRow">' +
                '<input class="text-input" id="popNameInput" type="text" maxlength="40" value="' + escapeHtml(SETTINGS.name || name || "") + '" aria-label="Display name">' +
                '<button class="btn sm" id="popNameSave" type="button">Save</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="pop-actions">' +
            '<a href="#/progress">' + icon("chart") + 'My Progress &amp; History</a>' +
            '<a href="#/guide">' + icon("book") + 'Exam Guide &amp; 30-Day Plan</a>' +
            '<button type="button" id="popBackup">' + icon("download") + 'Backup JSON</button>' +
            '<button type="button" id="popCsv">' + icon("file") + 'Export CSV</button>' +
            '<button type="button" id="popImport">' + icon("upload") + 'Import backup</button>' +
            '<input type="file" id="popImportFile" accept="application/json,.json" hidden>' +
          '</div>' +
          '<div class="form-msg" id="popMsg"></div>' +
          '<div class="pop-foot"><button class="btn secondary sm" id="popSignOut" type="button" style="width:100%;justify-content:center">' + icon("logout") + 'Sign Out</button></div>' +
        '</div>' +
      '</div>';

    const pill = slot.querySelector("#acctPill");
    const pop = slot.querySelector("#acctPop");
    pill.addEventListener("click", function (e) {
      e.stopPropagation();
      const openNow = pop.classList.toggle("open");
      pill.setAttribute("aria-expanded", String(openNow));
    });
    document.addEventListener("click", function (e) { if (!slot.contains(e.target)) pop.classList.remove("open"); });
    pop.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", function () { pop.classList.remove("open"); }); });

    slot.querySelector("#popEditName").addEventListener("click", function () {
      const row = slot.querySelector("#popNameRow");
      row.classList.toggle("open");
      const inp = slot.querySelector("#popNameInput");
      if (row.classList.contains("open")) inp.focus();
    });
    slot.querySelector("#popNameSave").addEventListener("click", function () {
      const v = slot.querySelector("#popNameInput").value.trim().slice(0, 40);
      SETTINGS.name = v;
      persistSettings();
      cloud.saveName();
      emit("auth", appState.user);
    });
    slot.querySelector("#popBackup").addEventListener("click", function () {
      exportBackupJson();
      popMsg("Backup downloaded — keep it somewhere safe.");
    });
    slot.querySelector("#popCsv").addEventListener("click", function () {
      exportHistoryCsv();
      popMsg("History CSV downloaded.");
    });
    const fileInp = slot.querySelector("#popImportFile");
    slot.querySelector("#popImport").addEventListener("click", function () { fileInp.click(); });
    fileInp.addEventListener("change", function () {
      const f = fileInp.files[0];
      if (!f) return;
      importBackupFile(f).then(function (res) {
        if (res.ok) { popMsg("Backup restored: " + res.count + " test(s) imported on this device."); emit("data"); }
        else popMsg("That file could not be read as a TypeSetu backup.", true);
        fileInp.value = "";
      });
    });
    slot.querySelector("#popSignOut").addEventListener("click", function () {
      import("../services/firebaseService.js").then(function (svc) {
        if (svc && svc.signOutUser) svc.signOutUser();
      }).catch(function () {});
      pop.classList.remove("open");
    });
    function popMsg(t, isErr) {
      const m = slot.querySelector("#popMsg");
      if (m) { m.textContent = t; m.className = "form-msg " + (isErr ? "err" : "ok"); }
    }
  }
  on("auth", render);
  on("sync", function (s) { syncState = s; render(); });
  on("data", render);
  render();
  return { close: close };
}

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
