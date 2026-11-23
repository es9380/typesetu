/* features/home/heroArt.js — decorative hero art. Pure CSS animation; JS only flashes keys. */
import { EXAM_SPECS } from "../../data/examSpecs.js";
import { icon } from "../../components/icons.js";
import { appState } from "../../core/state.js";
import { escapeHtml } from "../../components/ProfilePopover.js";

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm,."];
const DOTS = ["var(--accent)", "var(--accent-2)", "var(--pass)", "var(--target)"];
const BITS = ["98%", "WPM", "✓", "Aa", "+4", "↵", "30", "25"];

export function artHtml() {
  const keys = ROWS.map(function (r) {
    return '<div class="kb-row">' + r.split("").map(function (k) { return '<i class="key" data-k="' + k + '">' + k + "</i>"; }).join("") + "</div>";
  }).join("") + '<div class="kb-row"><i class="key space" data-k=" "></i></div>';
  const badges = EXAM_SPECS.slice(0, 4).map(function (s, i) {
    return '<div class="xbadge xb' + (i + 1) + (s.id === appState.activeExam ? " mine" : "") + '" style="--c:' + DOTS[i] + '">' +
      '<span class="xb-dot"></span><span class="xb-txt"><b>' + escapeHtml(s.short) + "</b><small>" +
      (s.targetWPM > 0 ? s.targetWPM + " WPM" : s.durationMin + " min") + " · " + escapeHtml(s.nature) + "</small></span></div>";
  }).join("");
  const bits = BITS.map(function (t, i) {
    return '<span class="pf" style="left:' + (8 + Math.round(Math.random() * 82)) + "%;animation-delay:-" + (i * 1.1).toFixed(1) + 's">' + t + "</span>";
  }).join("");
  return '<div class="hero-logo">' + icon("logo") + "</div>" + bits + '<div class="kb">' + keys + "</div>" + badges;
}

export function mountHeroArt(root) {
  const el = root.querySelector("#heroArt");
  if (!el) return { hit: function () {}, destroy: function () {} };
  const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const map = {};
  el.querySelectorAll(".key").forEach(function (k) { map[k.dataset.k] = k; });

  function hit(ch, ok) {                                       // called for every key the demo presses
    if (reduce) return;
    const k = map[String(ch).toLowerCase()]; if (!k || !k.animate) return;
    const c = ok ? "var(--accent)" : "var(--error)";
    k.animate([{ backgroundColor: c, color: "#fff", transform: "translateY(3px)", boxShadow: "0 0 22px " + c }, {}],
              { duration: 360, easing: "ease-out" });          // Web Animations API: no reflow, no class juggling
  }
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver(function (es) { el.classList.toggle("paused", !es[0].isIntersecting); }) : null;
  if (io) io.observe(el);
  return { hit: hit, destroy: function () { if (io) io.disconnect(); } };
}
