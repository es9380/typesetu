/* components/celebrate.js — tiny, dependency-free confetti for a new personal best.
   Respects prefers-reduced-motion. Pieces remove themselves; nothing is stored. */
const COLORS = ["#6366F1", "#22D3EE", "#10B981", "#F59E0B", "#F87171"];

export function confetti(count = 70) {
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frag = document.createDocumentFragment(), made = [];
    for (let i = 0; i < count; i++) {
      const el = document.createElement("i");
      el.className = "confetti-piece";
      el.style.left = (Math.random() * 100) + "vw";
      el.style.background = COLORS[i % COLORS.length];
      el.style.animationDuration = (1.8 + Math.random() * 1.6) + "s";
      el.style.animationDelay = (Math.random() * 0.4) + "s";
      el.style.transform = "rotate(" + Math.floor(Math.random() * 360) + "deg)";
      frag.appendChild(el); made.push(el);
    }
    document.body.appendChild(frag);
    setTimeout(function () { made.forEach(function (el) { el.remove(); }); }, 4200);
  } catch (e) {}
}

/* Call BEFORE the new result is saved: compares against the best net of earlier
   history entries (same exam when examId is given). Returns true if it is a new best. */
export function celebrateIfBest(net, history, examId) {
  const prev = (history || []).filter(function (x) { return !examId || x.examId === examId; });
  if (!prev.length) return false;               // first ever attempt is not a "record"
  const best = Math.max.apply(null, prev.map(function (x) { return x.net || 0; }));
  if (net > best) { confetti(); return true; }
  return false;
}
