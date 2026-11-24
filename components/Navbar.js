/* components/Navbar.js — the single-row sticky header (prompt §2):
   brand + Exam Switcher Pill | centre tabs | theme toggle + Account Pill.
   The drawer exists ONLY on mobile. The account slot is owned by
   ProfilePopover.js; Navbar just provides the mount point. */

import { EXAM_SPECS, specOf } from "../data/examSpecs.js";
import { appState, on, setActiveExam, setTheme } from "../core/state.js";
import { icon } from "./icons.js";

export const TABS = [
  { route: "home", label: "Home", icon: "home" },
  { route: "arena", label: "Exam Arena", icon: "arena" },
  { route: "studio", label: "Training Studio", icon: "keyboard" },
  { route: "progress", label: "Progress", icon: "chart" },
  { route: "ncrtc", label: "NCRTC Mocks", icon: "file" },
  { route: "vocab", label: "Vocab", icon: "file" }
];

export function routeHash(route) { return "#/" + (route === "home" ? "" : route); }

function currentTab() {
  const h = (location.hash || "#/").replace(/^#\//, "");
  const seg = h.split("/")[0];
  if (seg === "" || seg === "home") return "home";
  if (seg === "arena" || seg === "hubs" || seg === "hub") return "arena";
  if (seg === "studio" || seg === "drills" || seg === "warmup" || seg === "practice" || seg === "test") return "studio";
  if (seg === "progress" || seg === "revision") return "progress";
  if (seg === "ncrtc") return "ncrtc";
  if (seg === "vocab") return "vocab";
  return "";
}

export function mountNavbar(headerEl, accountSlotHtml) {
  const sp = specOf(appState.activeExam);
  headerEl.innerHTML =
    '<div class="header-in">' +
      '<a class="brand" href="#/" aria-label="TypeSetu home">' + icon("logo") + '<span>Type<em>Setu</em></span></a>' +
      '<div class="exam-switcher">' +
        '<button class="exam-pill" id="examPill" type="button" aria-haspopup="true" aria-expanded="false">' +
          '<span class="dot" aria-hidden="true"></span><span class="ep-name" id="examPillName">' + sp.short + '</span>' + icon("chevD") +
        '</button>' +
        '<div class="exam-menu" id="examMenu" role="menu">' +
          EXAM_SPECS.map(function (s) {
            return '<button type="button" role="menuitemradio" data-exam="' + s.id + '" aria-checked="' + (s.id === appState.activeExam) + '">' +
              '<span>' + s.name + '<span class="em-sub">' + s.posts + '</span></span>' +
              (s.id === appState.activeExam ? icon("check") : "") + '</button>';
          }).join("") +
        '</div>' +
      '</div>' +
      '<nav class="main-tabs" aria-label="Main">' +
        TABS.map(function (t) {
          return '<a href="' + routeHash(t.route) + '" data-tab="' + t.route + '">' + t.label + '</a>';
        }).join("") +
      '</nav>' +
      '<div class="header-actions">' +
        '<button class="icon-btn" id="themeToggle" type="button" aria-label="Toggle dark / light theme">' + icon(appState.theme === "dark" ? "sun" : "moon") + '</button>' +
        '<span id="accountSlot">' + (accountSlotHtml || "") + '</span>' +
        '<button class="icon-btn menu-btn" id="menuBtn" type="button" aria-label="Open menu">' + icon("menu") + '</button>' +
      '</div>' +
    '</div>';

  /* drawer (mobile only) */
  const drawerWrap = document.createElement("div");
  drawerWrap.innerHTML =
    '<div class="drawer-backdrop" id="drawerBackdrop"></div>' +
    '<aside class="drawer" id="drawer" aria-label="Menu">' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<span class="brand">' + icon("logo") + '<span>Type<em>Setu</em></span></span>' +
        '<button class="icon-btn" id="drawerClose" type="button" aria-label="Close menu">' + icon("x") + '</button>' +
      '</div>' +
      '<div class="dlabel">Go to</div>' +
      TABS.map(function (t) {
        return '<a class="dlink" href="' + routeHash(t.route) + '" data-tab="' + t.route + '">' + t.label + '</a>';
      }).join("") +
      '<a class="dlink" href="#/guide">Exam Guide &amp; 30-Day Plan</a>' +
      '<div class="dlabel">Exam</div>' +
      EXAM_SPECS.map(function (s) {
        return '<a class="dlink" href="#/arena" data-exam-link="' + s.id + '">' + s.name + '</a>';
      }).join("") +
    '</aside>';
  document.body.appendChild(drawerWrap);

  const menu = headerEl.querySelector("#examMenu");
  const pill = headerEl.querySelector("#examPill");
  function closeMenu() { menu.classList.remove("open"); pill.setAttribute("aria-expanded", "false"); }
  pill.addEventListener("click", function (e) {
    e.stopPropagation();
    const open = menu.classList.toggle("open");
    pill.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", function (e) { if (!menu.contains(e.target)) closeMenu(); });
  menu.querySelectorAll("[data-exam]").forEach(function (b) {
    b.addEventListener("click", function () { setActiveExam(b.getAttribute("data-exam")); closeMenu(); });
  });
  drawerWrap.querySelectorAll("[data-exam-link]").forEach(function (a) {
    a.addEventListener("click", function () { setActiveExam(a.getAttribute("data-exam-link")); closeDrawer(); });
  });

  const drawer = drawerWrap.querySelector("#drawer");
  const backdrop = drawerWrap.querySelector("#drawerBackdrop");
  function openDrawer() { drawer.classList.add("open"); backdrop.classList.add("open"); }
  function closeDrawer() { drawer.classList.remove("open"); backdrop.classList.remove("open"); }
  headerEl.querySelector("#menuBtn").addEventListener("click", openDrawer);
  drawerWrap.querySelector("#drawerClose").addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);
  drawer.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeDrawer); });

  headerEl.querySelector("#themeToggle").addEventListener("click", function () {
    setTheme(appState.theme === "dark" ? "light" : "dark");
  });

  function paintTabs() {
    const tab = currentTab();
    document.querySelectorAll("[data-tab]").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-tab") === tab);
    });
  }
  function paintExam() {
    const s = specOf(appState.activeExam);
    const name = headerEl.querySelector("#examPillName");
    if (name) name.textContent = s.short;
    menu.querySelectorAll("[data-exam]").forEach(function (b) {
      b.setAttribute("aria-checked", String(b.getAttribute("data-exam") === appState.activeExam));
    });
  }
  function paintTheme() {
    const t = headerEl.querySelector("#themeToggle");
    if (t) t.innerHTML = icon(appState.theme === "dark" ? "sun" : "moon");
  }
  on("exam", paintExam);
  on("theme", paintTheme);
  window.addEventListener("hashchange", paintTabs);
  paintTabs();

  return { refreshTabs: paintTabs };
}
