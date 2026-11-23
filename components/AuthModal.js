/* components/AuthModal.js — sign in / create account modal.
   The flows, validation, rate limits and error text are the current
   views.js flows, moved onto the Firebase modular SDK via
   services/firebaseService.js (loaded lazily — if it cannot load, the
   modal says sign-in is unavailable and practice continues as guest). */

import { icon } from "./icons.js";

let backdrop = null;
let svcPromise = null;

function loadService() {
  if (!svcPromise) svcPromise = import("../services/firebaseService.js").catch(function () { return null; });
  return svcPromise;
}

function el(html) { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; }

export function closeAuthModal() { if (backdrop) backdrop.classList.remove("open"); }

export function openAuthModal(mode) {
  if (!backdrop) build();
  backdrop.classList.add("open");
  switchTab(mode || "login");
}

function switchTab(mode) {
  backdrop.querySelectorAll(".auth-tabs button").forEach(function (b) {
    b.classList.toggle("active", b.getAttribute("data-mode") === mode);
  });
  backdrop.querySelector("#authLogin").style.display = mode === "login" ? "" : "none";
  backdrop.querySelector("#authSignup").style.display = mode === "signup" ? "" : "none";
}

function msg(id, text, isErr) {
  const m = backdrop.querySelector("#" + id);
  if (m) { m.textContent = text || ""; m.className = "form-msg " + (isErr ? "err" : "ok"); }
}
function fldErr(id, text) {
  const m = backdrop.querySelector("#" + id);
  if (m) m.textContent = text || "";
}
function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}
function errText(svc, e) {
  if (e && e.friendly) return e.friendly;
  return svc.friendlyAuthError(e);
}

function build() {
  backdrop = el(
    '<div class="modal-backdrop" id="authBackdrop">' +
    '<div class="modal" role="dialog" aria-modal="true" aria-label="Account">' +
      '<div class="modal-head"><h2>Your account</h2>' +
      '<button class="icon-btn" id="authClose" type="button" aria-label="Close">' + icon("x") + '</button></div>' +
      '<div class="auth-tabs"><button type="button" data-mode="login">Sign in</button><button type="button" data-mode="signup">Create account</button></div>' +

      '<form id="authLogin" novalidate>' +
        '<div class="field"><label for="liEmail">Email address</label><input id="liEmail" type="email" autocomplete="email"><div class="field-err" id="liEmailErr"></div></div>' +
        '<div class="field"><label for="liPass">Password</label><input id="liPass" type="password" autocomplete="current-password"><div class="field-err" id="liPassErr"></div></div>' +
        '<button class="btn" id="liSubmit" type="submit" style="width:100%;justify-content:center">Sign in</button>' +
        '<div class="form-msg" id="liMsg"></div>' +
        '<p style="margin-top:12px"><button class="btn ghost sm" id="liForgot" type="button">Forgot password?</button></p>' +
      '</form>' +

      '<form id="authSignup" style="display:none" novalidate>' +
        '<div class="field"><label for="suName">Your name</label><input id="suName" type="text" autocomplete="name" maxlength="40"></div>' +
        '<div class="field"><label for="suEmail">Email address</label><input id="suEmail" type="email" autocomplete="email"><div class="field-err" id="suEmailErr"></div></div>' +
        '<div class="field"><label for="suPass">Password (6+ characters)</label><input id="suPass" type="password" autocomplete="new-password"><div class="field-err" id="suPassErr"></div></div>' +
        '<button class="btn" id="suSubmit" type="submit" style="width:100%;justify-content:center">Create account</button>' +
        '<div class="form-msg" id="suMsg"></div>' +
      '</form>' +
      '<p class="small muted" style="margin-top:14px">No account needed to practise. Signing in just keeps your progress in sync across devices.</p>' +
    '</div></div>'
  );
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeAuthModal(); });
  backdrop.querySelector("#authClose").addEventListener("click", closeAuthModal);
  backdrop.querySelectorAll(".auth-tabs button").forEach(function (b) {
    b.addEventListener("click", function () { switchTab(b.getAttribute("data-mode")); });
  });

  backdrop.querySelector("#authLogin").addEventListener("submit", function (e) {
    e.preventDefault();
    const em = backdrop.querySelector("#liEmail").value.trim();
    const pw = backdrop.querySelector("#liPass").value || "";
    loadService().then(function (svc) {
      if (!svc || !svc.getAuthInstance()) { msg("liMsg", "Sign-in is unavailable right now. You can keep practising — results save on this device.", true); return; }
      fldErr("liEmailErr", svc.validEmail(em) ? "" : "That email address does not look valid — please check it.");
      fldErr("liPassErr", pw ? "" : "Enter your password.");
      if (!svc.validEmail(em) || !pw) return;
      const btn = backdrop.querySelector("#liSubmit");
      setBusy(btn, true, "Signing in…");
      msg("liMsg", "");
      svc.signIn(em, pw).then(function () {
        setBusy(btn, false);
        closeAuthModal();
      }).catch(function (err) { setBusy(btn, false); msg("liMsg", errText(svc, err), true); });
    });
  });

  backdrop.querySelector("#liForgot").addEventListener("click", function () {
    const em = backdrop.querySelector("#liEmail").value.trim();
    loadService().then(function (svc) {
      if (!svc || !svc.getAuthInstance()) { msg("liMsg", "Password reset is unavailable right now.", true); return; }
      if (!svc.validEmail(em)) { fldErr("liEmailErr", "Enter your email address first, then choose Forgot password."); return; }
      svc.resetPassword(em).then(function () {
        msg("liMsg", "If an account exists for that email, a reset link is on its way.");
      }).catch(function (err) {
        if (err && err.code === "auth/user-not-found") msg("liMsg", "If an account exists for that email, a reset link is on its way.");
        else msg("liMsg", errText(svc, err), true);
      });
    });
  });

  backdrop.querySelector("#authSignup").addEventListener("submit", function (e) {
    e.preventDefault();
    const nm = backdrop.querySelector("#suName").value.trim().slice(0, 40);
    const em = backdrop.querySelector("#suEmail").value.trim();
    const pw = backdrop.querySelector("#suPass").value || "";
    loadService().then(function (svc) {
      if (!svc || !svc.getAuthInstance()) { msg("suMsg", "Sign-up is unavailable right now. You can keep practising — results save on this device.", true); return; }
      fldErr("suEmailErr", svc.validEmail(em) ? "" : "That email address does not look valid — please check it.");
      fldErr("suPassErr", pw.length >= 6 ? "" : "Use at least 6 characters for your password.");
      if (!svc.validEmail(em) || pw.length < 6) return;
      const btn = backdrop.querySelector("#suSubmit");
      setBusy(btn, true, "Creating account…");
      msg("suMsg", "");
      svc.signUp(nm, em, pw).then(function () {
        setBusy(btn, false);
        closeAuthModal();
      }).catch(function (err) { setBusy(btn, false); msg("suMsg", errText(svc, err), true); });
    });
  });
}
