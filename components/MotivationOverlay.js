/* components/MotivationOverlay.js — the post-test motivation overlay.
   Behaviour verbatim from the current app (Push 5): after an exam-context
   finish the computed result is held behind this overlay for ~3.8s; a tap
   skips to it. Content per sid (23 Nov 2026): GENERIC Hinglish lines only
   — the personal names are gone; the overlay shows ONE line, no name
   element. Pools below are the generic pools verbatim.
   Shown for: HCM hub mocks + ALL Custom Tests (both engines).
   Never for: SSC/RRB hub mocks, practice finishes. */

export const MOTIV_GOOD = [
  "ese hi lage raho — sab ho jaega",
  "sab sahi hai — trust the process",
  "mehnat kabhi waste nahi jaati",
  "rukna nahi hai — bas chalte rehna hai",
  "bola tha na — ho gaya! ese hi roz thoda thoda",
  "sapne se bas kuch mock door ho",
  "dheere dheere hi sahi — race apni hi hai",
  "aaj ka mock kal ki seat pakki kar raha hai",
  "khud pe bharosa rakho — baaki sab ho jaega",
  "tension nahi lene ka — ho jaega"
];
export const MOTIV_KEEP = [
  "ek mock se kuch decide nahi hota — agla wala apna hai",
  "girna allowed hai, rukna nahi",
  "aaj speed kam hai, kal nahi hogi — practice jaari rakho",
  "galtiyan hi sikhati hain — seekhte raho",
  "haar tab hoti hai jab ruk jaate hain",
  "thoda sa aur — bas thoda sa aur roz"
];

let motivTimer = null, motivReveal = null, motivShown = false;

function motivPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function ensureMotivationOverlay() {
  let ov = document.getElementById("motivOverlay");
  if (ov) return ov;
  ov = document.createElement("div");
  ov.id = "motivOverlay";
  ov.className = "motiv-overlay";
  ov.setAttribute("aria-hidden", "true");
  ov.innerHTML = '<div class="motiv-card"><div class="motivLine" id="motivMsg"></div>' +
    '<div class="motiv-hint">Tap anywhere to see your result</div></div>';
  ov.addEventListener("click", function () { hideMotivation(true); });
  document.body.appendChild(ov);
  return ov;
}

export function showMotivation(qualified, revealFn) {
  const ov = ensureMotivationOverlay();
  if (motivShown) hideMotivation(true); /* never strand a held result */
  const msgEl = document.getElementById("motivMsg");
  if (msgEl) msgEl.textContent = motivPick(qualified ? MOTIV_GOOD : MOTIV_KEEP);
  motivReveal = (typeof revealFn === "function") ? revealFn : null;
  motivShown = true;
  ov.classList.add("show"); ov.setAttribute("aria-hidden", "false");
  const line = ov.querySelector(".motivLine");
  if (line) { line.style.animation = "none"; void line.offsetWidth; line.style.animation = ""; }
  motivTimer = setTimeout(function () { hideMotivation(true); }, 3800);
}

export function hideMotivation(runReveal) {
  const ov = document.getElementById("motivOverlay");
  if (motivTimer) { clearTimeout(motivTimer); motivTimer = null; }
  if (ov) { ov.classList.remove("show"); ov.setAttribute("aria-hidden", "true"); }
  motivShown = false;
  const fn = motivReveal; motivReveal = null;
  if (runReveal && fn) fn();
}
